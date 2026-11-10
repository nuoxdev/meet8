import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';

async function setup(mediaOverrides: Record<string, unknown> = {}) {
  const f = await fixture({}, mediaOverrides);
  const owner = await f.login('owner@example.com');
  const org = (
    await f.call(
      'POST',
      '/api/orgs',
      { name: 'Workshop', slug: 'workshop', managerEmail: 'host@example.com' },
      owner,
    )
  ).json();
  const host = await f.login('host@example.com');
  const m = (
    await f.call(
      'POST',
      `/api/orgs/${org.id}/meetings`,
      {
        title: 'Workshop',
        scheduledAt: '2027-01-15T10:00:00Z',
        durationMinutes: 45,
        timeZone: 'Asia/Dubai',
        access: 'link',
      },
      host,
    )
  ).json();
  await f.call('POST', `/api/orgs/${org.id}/meetings/${m.id}/start`, {}, host);
  const joined = await f.call('POST', `/api/meet/${m.code}/join`, {
    name: 'Guest',
    isCohost: true,
  });
  const guest = joined.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { ...f, host, m, guest, guestId: joined.json().attendee.id, base: `/api/meet/${m.code}` };
}
test('guest cohosts are meeting scoped and cannot assign roles; lowering hands and deleting chat require moderation', async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  assert.equal(
    (await f.call('GET', `${f.base}/session`, undefined, f.guest)).json().canModerate,
    false,
  );
  assert.equal(
    (
      await f.call(
        'POST',
        `${f.base}/moderate`,
        { action: 'cohost', attendeeId: f.guestId },
        f.guest,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.call(
        'POST',
        `${f.base}/moderate`,
        { action: 'cohost', attendeeId: f.guestId },
        f.host,
      )
    ).statusCode,
    200,
  );
  const session = (await f.call('GET', `${f.base}/session`, undefined, f.guest)).json();
  assert.equal(session.canModerate, true);
  assert.equal(session.canHost, false);
  assert.equal(session.canAssignCohost, false);
  await f.call('POST', `${f.base}/raise-hand`, { raised: true }, f.guest);
  assert.equal(
    (
      await f.call(
        'POST',
        `${f.base}/moderate`,
        { action: 'lower-hand', attendeeId: f.guestId },
        f.guest,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await f.call('GET', `${f.base}/session`, undefined, f.guest)).json().attendee.raised,
    false,
  );
  const msg = (await f.call('POST', `${f.base}/chat`, { body: 'hello' }, f.guest)).json();
  assert.equal(
    (await f.call('DELETE', `${f.base}/chat/${msg.id}`, undefined, f.guest)).statusCode,
    200,
  );
  assert.equal((await f.call('GET', `${f.base}/chat`, undefined, f.guest)).json().length, 0);
  assert.equal(
    (
      await f.call(
        'POST',
        `${f.base}/moderate`,
        { action: 'remove-cohost', attendeeId: f.guestId },
        f.guest,
      )
    ).statusCode,
    403,
  );
  await f.call(
    'POST',
    `${f.base}/moderate`,
    { action: 'remove-cohost', attendeeId: f.guestId },
    f.host,
  );
  assert.equal(
    (
      await f.call(
        'POST',
        `${f.base}/moderate`,
        { action: 'lower-hand', attendeeId: f.guestId },
        f.guest,
      )
    ).statusCode,
    403,
  );
});
test('disabled chat and locked admission are enforced while provider failures do not claim live permission changes', async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  assert.equal(
    (await f.call('PATCH', `${f.base}/settings`, { chatEnabled: false, locked: true }, f.host))
      .statusCode,
    200,
  );
  assert.equal(
    (await f.call('POST', `${f.base}/chat`, { body: 'blocked' }, f.guest)).statusCode,
    403,
  );
  assert.equal((await f.call('POST', `${f.base}/join`, { name: 'New guest' })).statusCode, 403);
  assert.equal(
    (await f.call('PATCH', `${f.base}/settings`, { microphoneAccess: 'hosts' }, f.host)).statusCode,
    503,
  );
  assert.equal(
    (await f.call('GET', `${f.base}/session`, undefined, f.guest)).json().settings.microphoneAccess,
    'everyone',
  );
  assert.equal(
    (await f.call('POST', `${f.base}/moderate`, { action: 'mute', attendeeId: f.guestId }, f.host))
      .statusCode,
    503,
  );
});

test('live source grants follow settings and cohost promotion and revocation; mute never remotely unmutes', async (t) => {
  const updates: { identity: string; permissions: any }[] = [];
  const muted: string[] = [];
  const f = await setup({
    updatePermissions: async (_room: string, identity: string, permissions: any) =>
      updates.push({ identity, permissions }),
    mute: async (_room: string, identity: string) => muted.push(identity),
  });
  t.after(() => f.app.close());
  assert.equal(
    (
      await f.call(
        'PATCH',
        `${f.base}/settings`,
        { microphoneAccess: 'hosts', cameraAccess: 'hosts', screenShareAccess: 'hosts' },
        f.host,
      )
    ).statusCode,
    200,
  );
  assert.deepEqual(updates.at(-1)?.permissions, {
    microphone: false,
    camera: false,
    screenShare: false,
    data: false,
  });
  assert.equal(
    (
      await f.call(
        'POST',
        `${f.base}/moderate`,
        { action: 'cohost', attendeeId: f.guestId },
        f.host,
      )
    ).statusCode,
    200,
  );
  assert.deepEqual(updates.at(-1)?.permissions, {
    microphone: true,
    camera: true,
    screenShare: true,
    data: false,
  });
  assert.equal(
    (
      await f.call(
        'POST',
        `${f.base}/moderate`,
        { action: 'remove-cohost', attendeeId: f.guestId },
        f.host,
      )
    ).statusCode,
    200,
  );
  assert.deepEqual(updates.at(-1)?.permissions, {
    microphone: false,
    camera: false,
    screenShare: false,
    data: false,
  });
  assert.equal(
    (await f.call('POST', `${f.base}/moderate`, { action: 'mute', attendeeId: f.guestId }, f.host))
      .statusCode,
    200,
  );
  assert.deepEqual(muted, [f.guestId]);
  assert.equal(
    (
      await f.call(
        'POST',
        `${f.base}/moderate`,
        { action: 'unmute', attendeeId: f.guestId },
        f.host,
      )
    ).statusCode,
    400,
  );
  await f.call(
    'PATCH',
    `${f.base}/settings`,
    { microphoneAccess: 'everyone', cameraAccess: 'everyone', screenShareAccess: 'everyone' },
    f.host,
  );
  assert.deepEqual(updates.at(-1)?.permissions, {
    microphone: true,
    camera: true,
    screenShare: true,
    data: false,
  });
  await f.call('POST', `${f.base}/moderate`, { action: 'cohost', attendeeId: f.guestId }, f.host);
  await f.call('POST', `${f.base}/leave`, {}, f.guest);
  assert.equal(
    (await f.call('PATCH', `${f.base}/settings`, { locked: true }, f.guest)).statusCode,
    403,
  );
});

test('signed LiveKit tokens limit publish sources and never bypass API chat policy', async () => {
  const { createMedia } = await import('../src/media.js');
  const media = createMedia({
    baseUrl: 'http://localhost:5173',
    production: false,
    devMail: false,
    ownerEmail: 'owner@example.com',
    livekitUrl: 'ws://localhost:7880',
    livekitKey: 'key',
    livekitSecret: 'a-secret-long-enough-for-test-signing',
  });
  const restricted = await media.token('meet8-session', 'participant', 'Guest', {
    microphone: false,
    camera: true,
    screenShare: false,
    data: false,
  });
  const claims = JSON.parse(Buffer.from(restricted.token.split('.')[1], 'base64url').toString());
  assert.equal(claims.video.canPublish, true);
  assert.deepEqual(claims.video.canPublishSources, ['camera']);
  assert.equal(claims.video.canPublishData, false);
  const blocked = await media.token('meet8-session', 'participant', 'Guest', {
    microphone: false,
    camera: false,
    screenShare: false,
    data: false,
  });
  const blockedClaims = JSON.parse(
    Buffer.from(blocked.token.split('.')[1], 'base64url').toString(),
  );
  assert.equal(blockedClaims.video.canPublish, false);
  assert.deepEqual(blockedClaims.video.canPublishSources, []);
});
