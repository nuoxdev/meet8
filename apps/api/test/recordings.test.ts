import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/store.js';
import { hash } from '../src/auth.js';
import { registerRecordingRoutes, type RecordingService } from '../src/recordings.js';
test('recording authority, private files, readiness, range playback and revocable hashed links', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'meet8-recordings-'));
  const store = new MemoryStore();
  const app = Fastify();
  await app.register(cookie);
  app.setErrorHandler((e, _req, reply) =>
    reply
      .code((e as { statusCode?: number }).statusCode ?? 500)
      .send({ error: (e as Error).message }),
  );
  let starts = 0;
  let complete = false;
  const service: RecordingService = {
    enabled: true,
    async start() {
      starts++;
      return 'egress-1';
    },
    async stop() {},
    async status() {
      return complete ? 'ready' : 'recording';
    },
  };
  const config = {
    ownerEmail: 'owner@example.com',
    baseUrl: 'http://localhost',
    production: false,
    devMail: true,
    recordingDirectory: dir,
  };
  await store.transaction((s) => {
    s.users.push({ id: 'host', email: 'host@example.com', name: 'Host', createdAt: '' });
    s.sessions.push({ hash: hash('host-cookie'), userId: 'host', expiresAt: Date.now() + 60000 });
    s.memberships.push({
      id: 'm',
      orgId: 'org',
      email: 'host@example.com',
      role: 'member',
      active: true,
    });
    s.meetings.push({
      id: 'meeting',
      orgId: 'org',
      code: '123456',
      createdBy: 'host',
      title: 'Test',
      description: '',
      scheduledAt: '',
      durationMinutes: 30,
      timeZone: 'UTC',
      access: 'link',
      invitees: [],
      status: 'live',
      sessionId: 'session',
      createdAt: '',
      cohostAttendeeIds: ['guest'],
    } as any);
    s.attendees.push({
      id: 'guest',
      orgId: 'org',
      meetingId: 'meeting',
      sessionId: 'session',
      guestHash: hash('guest-cookie'),
      name: 'Guest',
      memberAtJoin: false,
      raised: false,
      removed: false,
      joinedAt: '',
    });
  });
  await registerRecordingRoutes(app, store, config, service);
  const root = '/api/meet/123456/recordings';
  const headers = { cookie: 'meet8_session=host-cookie' };
  try {
    assert.equal((await app.inject({ method: 'POST', url: root + '/start' })).statusCode, 403);
    const start = await app.inject({ method: 'POST', url: root + '/start', headers });
    assert.equal(start.statusCode, 200);
    const rid = start.json().recording.id;
    assert.equal(
      (await app.inject({ method: 'POST', url: root + '/start', headers })).statusCode,
      409,
    );
    assert.equal(starts, 1);
    assert.equal(
      (await app.inject({ url: root, headers: { cookie: 'meet8_guest=guest-cookie' } })).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: root + `/${rid}/share`,
          headers: { cookie: 'meet8_guest=guest-cookie' },
        })
      ).statusCode,
      403,
    );
    await store.transaction((s) => {
      s.attendees[0].leftAt = new Date().toISOString();
    });
    assert.equal(
      (await app.inject({ url: root, headers: { cookie: 'meet8_guest=guest-cookie' } })).statusCode,
      403,
    );
    complete = true;
    let list = await app.inject({ url: root, headers });
    assert.equal(list.json().recordings[0].status, 'processing');
    await writeFile(join(dir, `${rid}.mp4`), '0123456789');
    list = await app.inject({ url: root, headers });
    assert.equal(list.json().recordings[0].status, 'ready');
    assert.equal(list.body.includes(dir), false);
    assert.equal(list.body.includes('egress-1'), false);
    assert.equal((await app.inject({ url: root + `/${rid}/file` })).statusCode, 403);
    const share = await app.inject({ method: 'POST', url: root + `/${rid}/share`, headers });
    assert.equal(share.statusCode, 200);
    const raw = share.json().url.split('/').pop();
    const publicUrl = '/api/recordings/shared/' + raw;
    const state = await store.transaction((s) => s);
    assert.equal(JSON.stringify(state).includes(raw), false);
    const range = await app.inject({ url: publicUrl, headers: { range: 'bytes=2-5' } });
    assert.equal(range.statusCode, 206);
    assert.equal(range.body, '2345');
    assert.equal(range.headers['content-range'], 'bytes 2-5/10');
    assert.equal(range.headers['cache-control'], 'no-store');
    assert.equal(
      (await app.inject({ url: publicUrl, headers: { range: 'bytes=30-' } })).statusCode,
      416,
    );
    await app.inject({ method: 'DELETE', url: root + `/${rid}/share`, headers });
    assert.equal((await app.inject({ url: publicUrl })).statusCode, 404);
    // Admission and membership are rechecked even for an already promoted co-host.
    await store.transaction((s) => {
      const a = s.attendees[0];
      delete a.leftAt;
      a.userId = 'cohost-user';
      a.memberAtJoin = true;
      s.users.push({
        id: 'cohost-user',
        email: 'cohost@example.com',
        name: 'Co-host',
        createdAt: '',
      });
      s.sessions.push({
        hash: hash('cohost-cookie'),
        userId: 'cohost-user',
        expiresAt: Date.now() + 60000,
      });
      s.memberships.push({
        id: 'cohost-membership',
        orgId: 'org',
        email: 'cohost@example.com',
        role: 'member',
        active: false,
      });
    });
    const cohostHeaders = { cookie: 'meet8_session=cohost-cookie' };
    assert.equal((await app.inject({ url: root, headers: cohostHeaders })).statusCode, 403);
    assert.equal(
      (await app.inject({ url: root + `/${rid}/file`, headers: cohostHeaders })).statusCode,
      403,
    );
    await store.transaction((s) => {
      s.memberships[1].active = true;
      s.meetings[0].access = 'invited';
      s.meetings[0].invitees = [];
    });
    assert.equal((await app.inject({ url: root, headers: cohostHeaders })).statusCode, 403);
    assert.equal(
      (await app.inject({ method: 'POST', url: root + '/start', headers: cohostHeaders }))
        .statusCode,
      403,
    );
    await store.transaction((s) => {
      s.meetings[0].access = 'link';
      s.meetings[0].sessionId = 'new-session';
      const a = s.attendees[0];
      delete a.userId;
      a.memberAtJoin = false;
      a.sessionId = 'new-session';
    });
    const guestHeaders = { cookie: 'meet8_guest=guest-cookie' };
    const currentOnly = await app.inject({ url: root, headers: guestHeaders });
    assert.equal(currentOnly.statusCode, 200);
    assert.equal(currentOnly.json().recordings.length, 0);
    assert.equal(
      (await app.inject({ url: root + `/${rid}/file`, headers: guestHeaders })).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: root + `/${rid}/stop`, headers: guestHeaders }))
        .statusCode,
      403,
    );
    assert.equal((await app.inject({ url: root, headers })).json().recordings.length, 1);
    let orphanStopped = false;
    service.start = async () => {
      await store.transaction((s) => {
        s.memberships[0].active = false;
      });
      return 'orphan';
    };
    service.stop = async (egressId) => {
      assert.equal(egressId, 'orphan');
      orphanStopped = true;
    };
    assert.equal(
      (await app.inject({ method: 'POST', url: root + '/start', headers })).statusCode,
      502,
    );
    assert.equal(orphanStopped, true);
    assert.equal((await app.inject({ url: root, headers })).statusCode, 403);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
