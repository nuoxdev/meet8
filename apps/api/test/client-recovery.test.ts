import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DisconnectReason } from 'livekit-client';
import { canRecoverDisconnect, recoverJoinedConnection } from '../../web/src/meetingRecovery.js';

const session = {
  status: 'live',
  sessionId: 'original',
  attendee: { id: 'guest' },
  mediaReady: true,
};
const connection = { sessionId: 'original', token: 'fresh', url: 'ws://local' };
function setup(overrides: Record<string, unknown> = {}) {
  const controller = new AbortController();
  const requests: string[] = [];
  const options = {
    expected: { sessionId: 'original', attendeeId: 'guest' },
    signal: controller.signal,
    remaining: { current: 3 },
    wait: async () => {},
    session: async () => {
      requests.push('session');
      return session;
    },
    connection: async () => {
      requests.push('connection');
      return connection;
    },
    ...overrides,
  };
  return { options, controller, requests };
}
test('terminal network disconnects are recoverable, explicit admission changes are not', () => {
  for (const reason of [
    undefined,
    DisconnectReason.UNKNOWN_REASON,
    DisconnectReason.SIGNAL_CLOSE,
    DisconnectReason.STATE_MISMATCH,
    DisconnectReason.CONNECTION_TIMEOUT,
    DisconnectReason.MEDIA_FAILURE,
    DisconnectReason.SERVER_SHUTDOWN,
  ])
    assert.equal(canRecoverDisconnect(reason), true);
  for (const reason of [
    DisconnectReason.CLIENT_INITIATED,
    DisconnectReason.DUPLICATE_IDENTITY,
    DisconnectReason.PARTICIPANT_REMOVED,
    DisconnectReason.ROOM_DELETED,
    DisconnectReason.JOIN_FAILURE,
  ])
    assert.equal(canRecoverDisconnect(reason), false);
});
test('fresh connection requires authoritative matching live session and attendee', async () => {
  const { options, requests } = setup();
  assert.deepEqual(await recoverJoinedConnection(options), connection);
  assert.deepEqual(requests, ['session', 'connection']);
});
for (const changed of [
  { ...session, status: 'ended' },
  { ...session, sessionId: 'restarted' },
  { ...session, attendee: { id: 'another' } },
  { ...session, mediaReady: false },
])
  test(`does not reconnect after session changes: ${JSON.stringify(changed)}`, async () => {
    const { options, requests } = setup({ session: async () => changed });
    await assert.rejects(recoverJoinedConnection(options));
    assert.deepEqual(requests, []);
  });
test('removal or revoked access does not retry', async () => {
  let calls = 0;
  const { options } = setup({
    session: async () => {
      calls++;
      throw Object.assign(new Error('Removed'), { status: 403 });
    },
  });
  await assert.rejects(recoverJoinedConnection(options));
  assert.equal(calls, 1);
});
test('transient API outage is bounded across recoveries', async () => {
  let calls = 0;
  const { options } = setup({
    session: async () => {
      calls++;
      throw Object.assign(new Error('Offline'), { status: 503 });
    },
  });
  await assert.rejects(recoverJoinedConnection(options));
  assert.equal(calls, 3);
  await assert.rejects(recoverJoinedConnection(options));
  assert.equal(calls, 3);
});
test('explicit leave invalidates an in-flight authority response before token request', async () => {
  const { options, controller, requests } = setup();
  options.session = async () => {
    controller.abort();
    return session;
  };
  await assert.rejects(recoverJoinedConnection(options));
  assert.deepEqual(requests, []);
});
test('explicit leave invalidates an in-flight fresh token response', async () => {
  const { options, controller } = setup();
  options.connection = async () => {
    controller.abort();
    return connection;
  };
  await assert.rejects(recoverJoinedConnection(options));
});
