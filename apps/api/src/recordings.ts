import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EgressClient, EncodedFileOutput, EncodedFileType, EgressStatus } from 'livekit-server-sdk';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import type { Config } from './config.js';
import type { Store, State, Meeting } from './store.js';
import { ApiError, optionalUser, hash, token, id, now, audit } from './auth.js';
export type Recording = {
  id: string;
  meetingId: string;
  sessionId: string;
  createdAt: string;
  status: 'starting' | 'recording' | 'processing' | 'ready' | 'failed';
  egressId?: string;
  shareHash?: string;
  shareExpiresAt?: number;
};
type RecordingState = State & { recordings?: Recording[] };
type RecordingMeeting = Meeting & { cohostAttendeeIds?: string[] };
export type RecordingConfig = Config & { recordingEnabled?: boolean; recordingDirectory?: string };
export interface RecordingService {
  enabled: boolean;
  start(room: string, recordingId: string): Promise<string>;
  stop(egressId: string): Promise<void>;
  status(egressId: string): Promise<Recording['status']>;
  recover?(room: string, recordingId: string): Promise<string | undefined>;
}
export function createRecordingService(c: RecordingConfig): RecordingService {
  const enabled = Boolean(
    c.recordingEnabled &&
    c.livekitInternalUrl &&
    c.livekitKey &&
    c.livekitSecret &&
    !c.livekitCloud,
  );
  const client = enabled
    ? new EgressClient(c.livekitInternalUrl!.replace(/^ws/, 'http'), c.livekitKey, c.livekitSecret)
    : undefined;
  return {
    enabled,
    async recover(room, recordingId) {
      if (!client) return undefined;
      const list = await client.listEgress({ roomName: room });
      return list.find(
        (r) =>
          r.fileResults.some((f) => f.filename.endsWith(`/${recordingId}.mp4`)) ||
          (r.request.case === 'roomComposite' &&
            (r.request.value.fileOutputs.some(
              (f) => f.filepath === `/recordings/${recordingId}.mp4`,
            ) ||
              (r.request.value.output.case === 'file' &&
                r.request.value.output.value.filepath === `/recordings/${recordingId}.mp4`))),
      )?.egressId;
    },
    async start(room, recordingId) {
      if (!client) throw new ApiError(503, 'Recording is not configured.');
      const r = await client.startRoomCompositeEgress(
        room,
        new EncodedFileOutput({
          filepath: `/recordings/${recordingId}.mp4`,
          fileType: EncodedFileType.MP4,
        }),
        { layout: 'grid' },
      );
      return r.egressId;
    },
    async stop(egressId) {
      if (!client) throw new ApiError(503, 'Recording is not configured.');
      await client.stopEgress(egressId);
    },
    async status(egressId) {
      if (!client) throw new ApiError(503, 'Recording is not configured.');
      const r = (await client.listEgress({ egressId }))[0];
      if (!r) return 'failed';
      if (r.status === EgressStatus.EGRESS_COMPLETE) return 'ready';
      if (
        [
          EgressStatus.EGRESS_FAILED,
          EgressStatus.EGRESS_ABORTED,
          EgressStatus.EGRESS_LIMIT_REACHED,
        ].includes(r.status)
      )
        return 'failed';
      return r.status === EgressStatus.EGRESS_ACTIVE ? 'recording' : 'processing';
    },
  };
}
const rows = (s: RecordingState) => (s.recordings ??= []);
export function recordingSessionState(s: State, m: Meeting) {
  return {
    recordingActive: rows(s).some(
      (r) => r.meetingId === m.id && ['starting', 'recording', 'processing'].includes(r.status),
    ),
  };
}
function authority(s: State, m: RecordingMeeting, req: FastifyRequest, c: Config, cohost = true) {
  const u = optionalUser(s, req);
  if (
    u &&
    (u.email === c.ownerEmail ||
      (s.memberships.some((x) => x.orgId === m.orgId && x.email === u.email && x.active) &&
        (m.createdBy === u.id ||
          s.memberships.some(
            (x) => x.orgId === m.orgId && x.email === u.email && x.active && x.role === 'manager',
          ))))
  )
    return 'host' as const;
  if (
    cohost &&
    s.attendees.some(
      (a) =>
        a.meetingId === m.id &&
        a.sessionId === m.sessionId &&
        !a.removed &&
        !a.leftAt &&
        (!a.memberAtJoin ||
          (!!u &&
            (u.email === c.ownerEmail ||
              s.memberships.some(
                (x) => x.orgId === m.orgId && x.email === u.email && x.active,
              )))) &&
        (m.access !== 'invited' || (!!u && m.invitees.includes(u.email))) &&
        m.cohostAttendeeIds?.includes(a.id) &&
        (u
          ? a.userId === u.id
          : !a.userId &&
            !!req.cookies.meet8_guest &&
            a.guestHash === hash(req.cookies.meet8_guest)),
    )
  )
    return 'cohost' as const;
  throw new ApiError(403, 'Only the host or a current co-host can manage recordings.');
}
const visible = (r: Recording) => ({
  id: r.id,
  createdAt: r.createdAt,
  status: r.status,
  shared: !!r.shareHash && (r.shareExpiresAt ?? 0) > Date.now(),
  shareExpiresAt: r.shareExpiresAt,
});
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ApiError(504, 'Recording service timed out.')), 15000);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export async function registerRecordingRoutes(
  app: FastifyInstance,
  store: Store,
  config: RecordingConfig,
  service: RecordingService,
) {
  const find = (s: State, code: string) => {
    const m = s.meetings.find((m) => m.code === code);
    if (!m) throw new ApiError(404, 'Meeting not found.');
    return m;
  };
  const file = (r: Recording) => resolve(config.recordingDirectory ?? '/recordings', `${r.id}.mp4`);
  async function refresh(r: Recording) {
    if (['ready', 'failed'].includes(r.status)) return;
    if (!r.egressId) {
      const recovered = await bounded(
        service.recover?.(`meet8-${r.sessionId}`, r.id) ?? Promise.resolve(undefined),
      );
      if (!recovered) return;
      r.egressId = recovered;
      await store.transaction((s) => {
        rows(s).find((x) => x.id === r.id)!.egressId = recovered;
      });
    }
    const status = await bounded(service.status(r.egressId));
    let next = status;
    if (status === 'ready') {
      try {
        const h = await open(file(r), constants.O_RDONLY | constants.O_NOFOLLOW);
        const st = await h.stat();
        await h.close();
        if (!st.isFile() || !st.size) next = 'processing';
      } catch {
        next = 'processing';
      }
    }
    await store.transaction((s) => {
      const current = rows(s).find((x) => x.id === r.id);
      if (current && !['ready', 'failed'].includes(current.status)) current.status = next;
    });
  }
  let reconciling = false;
  const timer = setInterval(async () => {
    if (reconciling || !service.enabled) return;
    reconciling = true;
    try {
      const active = await store.transaction((s) =>
        rows(s).filter((r) => !['ready', 'failed'].includes(r.status)),
      );
      await Promise.allSettled(active.map(refresh));
    } catch {
      app.log.warn('Recording reconciliation failed; retrying on next poll.');
    } finally {
      reconciling = false;
    }
  }, 5000);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
  app.get<{ Params: { code: string } }>('/api/meet/:code/recordings', async (req) => {
    const list = await store.transaction((s) => {
      const m = find(s, req.params.code);
      const role = authority(s, m, req, config);
      return rows(s).filter(
        (r) => r.meetingId === m.id && (role === 'host' || r.sessionId === m.sessionId),
      );
    });
    await Promise.all(list.map(refresh));
    return store.transaction((s) => {
      const m = find(s, req.params.code);
      const role = authority(s, m, req, config);
      return {
        enabled: service.enabled,
        recordings: rows(s)
          .filter(
            (r) =>
              list.some((x) => x.id === r.id) && (role === 'host' || r.sessionId === m.sessionId),
          )
          .map(visible),
      };
    });
  });
  app.post<{ Params: { code: string } }>('/api/meet/:code/recordings/start', async (req) => {
    if (!service.enabled) throw new ApiError(503, 'Recording is not configured.');
    const r = await store.transaction((s) => {
      const m = find(s, req.params.code);
      authority(s, m, req, config);
      if (m.status !== 'live' || !m.sessionId) throw new ApiError(409, 'Start the meeting first.');
      if (recordingSessionState(s, m).recordingActive)
        throw new ApiError(409, 'A recording is already active.');
      const r: Recording = {
        id: id(),
        meetingId: m.id,
        sessionId: m.sessionId,
        createdAt: now(),
        status: 'starting',
      };
      rows(s).push(r);
      audit(s, 'host', 'recording.start', r.id, m.orgId);
      return r;
    });
    try {
      const egressId = await bounded(service.start(`meet8-${r.sessionId}`, r.id));
      try {
        await store.transaction((s) => {
          const m = find(s, req.params.code);
          authority(s, m, req, config);
          if (m.status !== 'live' || m.sessionId !== r.sessionId)
            throw new ApiError(409, 'Meeting is no longer live.');
          const x = rows(s).find((x) => x.id === r.id)!;
          x.egressId = egressId;
          x.status = 'recording';
        });
      } catch (error) {
        await store.transaction((s) => {
          rows(s).find((x) => x.id === r.id)!.egressId = egressId;
        });
        await bounded(service.stop(egressId));
        await store.transaction((s) => {
          rows(s).find((x) => x.id === r.id)!.status = 'processing';
        });
        throw error;
      }
      return { recording: visible({ ...r, status: 'recording' }) };
    } catch (e) {
      throw new ApiError(
        502,
        'Recording start could not be confirmed. The reserved recording remains pending to prevent duplicates; check the Egress service.',
      );
    }
  });
  type Params = { code: string; recordingId: string };
  async function authorized(req: FastifyRequest<{ Params: Params }>, share = false) {
    return store.transaction((s) => {
      const m = find(s, req.params.code);
      const role = authority(s, m, req, config, !share);
      const r = rows(s).find((r) => r.id === req.params.recordingId && r.meetingId === m.id);
      if (!r) throw new ApiError(404, 'Recording not found.');
      if (role === 'cohost' && r.sessionId !== m.sessionId)
        throw new ApiError(403, 'Co-host access is limited to the current meeting session.');
      return r;
    });
  }
  app.post<{ Params: Params }>('/api/meet/:code/recordings/:recordingId/stop', async (req) => {
    const r = await authorized(req);
    if (!r.egressId || !['recording', 'processing'].includes(r.status))
      throw new ApiError(409, 'Recording is not active.');
    await bounded(service.stop(r.egressId));
    await store.transaction((s) => {
      const x = rows(s).find((x) => x.id === r.id)!;
      if (x.status !== 'ready') x.status = 'processing';
    });
    return { ok: true };
  });
  app.post<{ Params: Params }>('/api/meet/:code/recordings/:recordingId/share', async (req) => {
    const r = await authorized(req, true);
    await refresh(r);
    const raw = token();
    const expiresAt = Date.now() + 7 * 86400000;
    await store.transaction((s) => {
      authority(s, find(s, req.params.code), req, config, false);
      const x = rows(s).find((x) => x.id === r.id)!;
      if (x.status !== 'ready') throw new ApiError(409, 'Recording is still processing.');
      x.shareHash = hash(raw);
      x.shareExpiresAt = expiresAt;
    });
    return { url: new URL(`/recordings/${raw}`, config.baseUrl).href, expiresAt };
  });
  app.delete<{ Params: Params }>('/api/meet/:code/recordings/:recordingId/share', async (req) => {
    const r = await authorized(req, true);
    await store.transaction((s) => {
      authority(s, find(s, req.params.code), req, config, false);
      const x = rows(s).find((x) => x.id === r.id)!;
      delete x.shareHash;
      delete x.shareExpiresAt;
    });
    return { ok: true };
  });
  async function send(r: Recording, req: FastifyRequest, reply: FastifyReply) {
    if (r.status !== 'ready') throw new ApiError(409, 'Recording is not ready.');
    let h;
    try {
      h = await open(file(r), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw new ApiError(404, 'Recording file is unavailable.');
    }
    const st = await h.stat();
    if (!st.isFile() || !st.size) {
      await h.close();
      throw new ApiError(404, 'Recording file is unavailable.');
    }
    let start = 0,
      end = st.size - 1;
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        await h.close();
        return reply.code(416).header('content-range', `bytes */${st.size}`).send();
      }
      if (!match[1]) start = Math.max(0, st.size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= st.size
      ) {
        await h.close();
        return reply.code(416).header('content-range', `bytes */${st.size}`).send();
      }
      reply.code(206).header('content-range', `bytes ${start}-${end}/${st.size}`);
    }
    reply
      .header('content-type', 'video/mp4')
      .header('cache-control', 'no-store')
      .header('accept-ranges', 'bytes')
      .header('content-length', end - start + 1)
      .header('content-disposition', `inline; filename="meeting-recording-${r.id}.mp4"`);
    return reply.send(h.createReadStream({ start, end, autoClose: true }));
  }
  app.get<{ Params: Params }>('/api/meet/:code/recordings/:recordingId/file', async (req, reply) =>
    send(await authorized(req), req, reply),
  );
  app.get<{ Params: { token: string } }>('/api/recordings/shared/:token', async (req, reply) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(req.params.token))
      throw new ApiError(404, 'This recording link is unavailable.');
    const r = await store.transaction((s) =>
      rows(s).find(
        (r) => r.shareHash === hash(req.params.token) && (r.shareExpiresAt ?? 0) > Date.now(),
      ),
    );
    if (!r) throw new ApiError(404, 'This recording link is unavailable or expired.');
    return send(r, req, reply);
  });
}
