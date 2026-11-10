import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { fixture } from './helpers.js';
import { verifySignalAccess } from '../src/signaling.js';
const config = {
  ownerEmail: 'owner@example.com',
  baseUrl: 'http://localhost:5173',
  production: false,
  devMail: false,
  livekitGateway: true,
  livekitInternalUrl: 'http://127.0.0.1:9',
  livekitKey: 'meet8-test',
  livekitSecret: 'meet8-test-secret-long-enough-to-sign',
};
async function setup() {
  const f = await fixture(config);
  const owner = await f.login('owner@example.com');
  const org = (
    await f.call(
      'POST',
      '/api/orgs',
      { name: 'Company', slug: 'company', managerEmail: 'owner@example.com' },
      owner,
    )
  ).json();
  const meeting = (
    await f.call(
      'POST',
      `/api/orgs/${org.id}/meetings`,
      {
        title: 'Gateway test',
        description: '',
        scheduledAt: new Date().toISOString(),
        durationMinutes: 30,
        timeZone: 'Asia/Dubai',
        access: 'link',
        invitees: [],
      },
      owner,
    )
  ).json();
  await f.call('POST', `/api/orgs/${org.id}/meetings/${meeting.id}/start`, {}, owner);
  const joined = await f.call('POST', `/api/meet/${meeting.code}/join`, { name: 'Client' });
  const guest = joined.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const state = (await f.call('GET', `/api/meet/${meeting.code}/session`, undefined, guest)).json();
  async function jwt(room = `meet8-${state.sessionId}`, identity = state.attendee.id, ttl = '60s') {
    const access = new AccessToken(config.livekitKey, config.livekitSecret, { identity, ttl });
    access.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
    return access.toJwt();
  }
  return { ...f, owner, org, meeting, state, guest, jwt };
}
test('gateway accepts a current participant but denies a saved token after removal', async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const raw = await f.jwt();
  assert.equal((await verifySignalAccess(f.store, config, raw)).identity, f.state.attendee.id);
  await f.call(
    'POST',
    `/api/meet/${f.meeting.code}/remove`,
    { attendeeId: f.state.attendee.id },
    f.owner,
  );
  await assert.rejects(() => verifySignalAccess(f.store, config, raw), /access|participant|join/i);
});
test('gateway rejects malformed and forged tokens', async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  await assert.rejects(() => verifySignalAccess(f.store, config, awaitValue('bad.token.value')));
  await assert.rejects(() => verifySignalAccess(f.store, config, awaitValue('')));
  await assert.rejects(() => verifySignalAccess(f.store, config, fakeToken));
});
function awaitValue(value: string) {
  return value;
}
const fakeToken = 'not-a-real-token';
test('valid signed token cannot cross meetings or reuse an ended meeting room', async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const wrong = await f.jwt('meet8-wrong-room');
  await assert.rejects(() => verifySignalAccess(f.store, config, wrong));
  const raw = await f.jwt();
  await f.call('POST', `/api/orgs/${f.org.id}/meetings/${f.meeting.id}/end`, {}, f.owner);
  await assert.rejects(() => verifySignalAccess(f.store, config, raw));
  await f.call('POST', `/api/orgs/${f.org.id}/meetings/${f.meeting.id}/restart`, {}, f.owner);
  await assert.rejects(() => verifySignalAccess(f.store, config, raw));
});
test('gateway proxies binary signaling and never opens upstream for denied tokens', async (t) => {
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  let connections = 0;
  upstream.on('connection', (socket) => {
    connections++;
    socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary }));
  });
  const f = await setup();
  t.after(async () => {
    for (const client of upstream.clients) client.terminate();
    upstream.close();
    await f.app.close();
  });
  config.livekitInternalUrl = `http://127.0.0.1:${(upstream.address() as any).port}`;
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp({
    store: f.store,
    config,
    mailer: { sendCode: async () => {}, sendInvitation: async () => {} },
    media: {
      ready: true,
      cloud: false,
      token: async () => ({ url: '', token: '' }),
      end: async () => {},
      remove: async () => {},
    },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  t.after(() => app.close());
  const url = `ws://127.0.0.1:${(app.server.address() as any).port}/media/rtc`;
  const denied = new WebSocket(`${url}?access_token=bad`, { origin: config.baseUrl });
  await once(denied, 'error').catch(() => {});
  assert.equal(connections, 0);
  const socket = new WebSocket(`${url}?access_token=${encodeURIComponent(await f.jwt())}`, {
    origin: config.baseUrl,
  });
  await once(socket, 'open');
  const response = once(socket, 'message');
  socket.send(Buffer.from([1, 2, 3]));
  const [data, binary] = await response;
  assert.deepEqual(Buffer.from(data), Buffer.from([1, 2, 3]));
  assert.equal(binary, true);
  socket.close();
  await once(socket, 'close');
  assert.equal(connections, 1);
});

test('expired tokens, explicit leave and revoked membership or invite deny signaling', async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const expired = await f.jwt(undefined, undefined, '-5s');
  await assert.rejects(() => verifySignalAccess(f.store, config, expired));
  const raw = await f.jwt();
  await f.store.transaction((s) => {
    const a = s.attendees.find((x) => x.id === f.state.attendee.id)!;
    a.leftAt = new Date().toISOString();
  });
  await assert.rejects(() => verifySignalAccess(f.store, config, raw));
  await f.store.transaction((s) => {
    const a = s.attendees.find((x) => x.id === f.state.attendee.id)!;
    a.leftAt = undefined;
    a.userId = 'member-id';
    a.memberAtJoin = true;
    a.email = 'member@example.com';
    s.users.push({
      id: 'member-id',
      name: 'Member',
      email: 'member@example.com',
      createdAt: new Date().toISOString(),
    });
    s.memberships.push({
      id: 'membership-id',
      orgId: f.org.id,
      email: 'member@example.com',
      role: 'member',
      active: true,
    });
  });
  await verifySignalAccess(f.store, config, raw);
  await f.store.transaction((s) => {
    s.memberships.find((m) => m.id === 'membership-id')!.active = false;
  });
  await assert.rejects(() => verifySignalAccess(f.store, config, raw));
  await f.store.transaction((s) => {
    s.attendees.find((a) => a.id === f.state.attendee.id)!.memberAtJoin = false;
    const m = s.meetings.find((m) => m.id === f.meeting.id)!;
    m.access = 'invited';
    m.invitees = ['member@example.com'];
  });
  await verifySignalAccess(f.store, config, raw);
  await f.store.transaction((s) => {
    s.meetings.find((m) => m.id === f.meeting.id)!.invitees = [];
  });
  await assert.rejects(() => verifySignalAccess(f.store, config, raw));
});

test('gateway rejects stale media grants after live policy restrictions and accepts a newly limited token', async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const old = await f.jwt();
  await f.store.transaction((s) => {
    s.meetings.find((m) => m.id === f.meeting.id)!.settings = {
      microphoneAccess: 'hosts',
      cameraAccess: 'everyone',
      screenShareAccess: 'hosts',
      chatEnabled: false,
      locked: false,
    };
  });
  await assert.rejects(() => verifySignalAccess(f.store, config, old), /permissions|access/i);
  const limited = new AccessToken(config.livekitKey, config.livekitSecret, {
    identity: f.state.attendee.id,
    ttl: '60s',
  });
  limited.addGrant({
    room: `meet8-${f.state.sessionId}`,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.CAMERA],
    canSubscribe: true,
    canPublishData: false,
  });
  assert.equal(
    (await verifySignalAccess(f.store, config, await limited.toJwt())).identity,
    f.state.attendee.id,
  );
});
