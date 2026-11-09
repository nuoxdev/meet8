import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TokenVerifier } from 'livekit-server-sdk';
import { WebSocket, type RawData } from 'ws';
import type { Store, State } from './store.js';
import type { Config } from './config.js';
import { ApiError, isOwner } from './auth.js';
type SignalAccess = { identity: string; room: string };
async function claims(config: Config, raw: string): Promise<SignalAccess> {
  if (!raw || raw.length > 8192 || !config.livekitKey || !config.livekitSecret)
    throw new ApiError(401, 'Invalid media access token.');
  try {
    const c = await new TokenVerifier(config.livekitKey, config.livekitSecret).verify(raw, 0);
    if (!c.sub || !c.video?.roomJoin || !c.video.room) throw new Error();
    return { identity: c.sub, room: c.video.room };
  } catch {
    throw new ApiError(401, 'Invalid or expired media access token.');
  }
}
function authorizeSignalState(s: State, access: SignalAccess, c: Config) {
  const a = s.attendees.find((a) => a.id === access.identity);
  const m = a && s.meetings.find((m) => m.id === a.meetingId && m.orgId === a.orgId);
  if (
    !a ||
    !m ||
    m.status !== 'live' ||
    a.removed ||
    a.leftAt ||
    !m.sessionId ||
    a.sessionId !== m.sessionId ||
    access.room !== `meet8-${m.sessionId}`
  )
    throw new ApiError(403, 'This participant no longer has access to the meeting.');
  const user = a.userId ? s.users.find((u) => u.id === a.userId) : undefined;
  const member =
    user && s.memberships.find((x) => x.orgId === m.orgId && x.email === user.email && x.active);
  if (a.memberAtJoin && (!user || (!isOwner(user, c.ownerEmail) && !member)))
    throw new ApiError(403, 'Organization access has been revoked.');
  const host =
    user &&
    (isOwner(user, c.ownerEmail) ||
      (member && (m.createdBy === user.id || member.role === 'manager')));
  if (m.access === 'invited' && !host && (!user || !m.invitees.includes(user.email)))
    throw new ApiError(403, 'This participant is not invited to the meeting.');
}
export async function verifySignalAccess(
  store: Store,
  config: Config,
  raw: string,
): Promise<SignalAccess> {
  const access = await claims(config, raw);
  await store.transaction((s) => authorizeSignalState(s, access, config));
  return access;
}
function requestToken(request: FastifyRequest) {
  const values = new URL(request.url, 'http://internal').searchParams.getAll('access_token');
  if (values.length !== 1) throw new ApiError(401, 'A single media access token is required.');
  return values[0];
}
export async function registerSignaling(
  app: FastifyInstance,
  options: { store: Store; config: Config },
) {
  const { store, config } = options;
  if (!config.livekitGateway || !config.livekitInternalUrl) return;
  const sockets = new Set<WebSocket>();
  app.addHook('preClose', async () => {
    for (const socket of sockets) socket.terminate();
    sockets.clear();
  });
  async function validate(request: FastifyRequest) {
    const origin = request.headers.origin;
    if (
      (origin && origin !== new URL(config.baseUrl).origin) ||
      (config.production && request.headers.upgrade?.toLowerCase() === 'websocket' && !origin)
    )
      throw new ApiError(403, 'Media connection origin is not allowed.');
    await verifySignalAccess(store, config, requestToken(request));
  }
  for (const rtcPath of ['/rtc', '/rtc/v1']) {
    app.get(`/media${rtcPath}/validate`, { preValidation: validate }, async (request, reply) => {
      const target = new URL(
        `${rtcPath}/validate`,
        config.livekitInternalUrl!.replace(/^ws/, 'http'),
      );
      target.search = new URL(request.url, 'http://internal').search;
      let response: Response;
      try {
        response = await fetch(target, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      } catch {
        throw new ApiError(503, 'Meeting signaling is temporarily unavailable.');
      }
      const body = await response.text();
      if (body.length > 65536) throw new ApiError(502, 'Unexpected media validation response.');
      return reply
        .code(response.status)
        .type(response.headers.get('content-type') ?? 'text/plain')
        .send(body);
    });
    app.route({
      method: 'GET',
      url: `/media${rtcPath}`,
      preValidation: validate,
      handler: async (_req, reply) =>
        reply.code(426).send({ error: 'WebSocket upgrade required.' }),
      wsHandler(socket, request) {
        sockets.add(socket);
        let upstream: WebSocket | undefined;
        let queued: { data: Buffer; binary: boolean }[] = [];
        let queuedSize = 0;
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          queued = [];
          sockets.delete(socket);
          if (upstream) {
            sockets.delete(upstream);
            if (upstream.readyState === WebSocket.OPEN) upstream.close();
            else upstream.terminate();
          }
          if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'Media connection closed.');
        };
        socket.on('error', close);
        socket.on('close', close);
        socket.on('message', (data: RawData, binary: boolean) => {
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          if (upstream?.readyState === WebSocket.OPEN) {
            if (upstream.bufferedAmount > 2_000_000) {
              close();
              return;
            }
            upstream.send(buffer, { binary });
          } else {
            queuedSize += buffer.byteLength;
            if (queuedSize > 128_000) {
              close();
              return;
            }
            queued.push({ data: buffer, binary });
          }
        });
        void (async () => {
          const access = await claims(config, requestToken(request));
          await store.transaction(async (s) => {
            authorizeSignalState(s, access, config);
            if (closed) return;
            const target = new URL(rtcPath, config.livekitInternalUrl!.replace(/^http/, 'ws'));
            target.search = new URL(request.url, 'http://internal').search;
            await new Promise<void>((resolve, reject) => {
              upstream = new WebSocket(target, {
                handshakeTimeout: 5000,
                maxPayload: 1_000_000,
                followRedirects: false,
              });
              sockets.add(upstream);
              upstream.on('message', (data, binary) => {
                if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 2_000_000) {
                  close();
                  return;
                }
                socket.send(data, { binary });
              });
              upstream.once('open', () => {
                if (closed) {
                  upstream?.terminate();
                  resolve();
                  return;
                }
                for (const item of queued) upstream!.send(item.data, { binary: item.binary });
                queued = [];
                queuedSize = 0;
                resolve();
              });
              upstream.on('error', () => {
                reject(new Error('Media upstream unavailable.'));
                close();
              });
              upstream.on('close', () => {
                reject(new Error('Media upstream closed.'));
                close();
              });
            });
          });
        })().catch(close);
      },
    });
  }
}
