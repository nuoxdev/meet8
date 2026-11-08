import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
async function setup() {
  const f = await fixture();
  const owner = await f.login('owner@example.com');
  const org = (
    await f.call(
      'POST',
      '/api/orgs',
      { name: 'Element8', slug: 'element8', managerEmail: 'host@example.com' },
      owner,
    )
  ).json();
  const host = await f.login('host@example.com');
  return { ...f, owner, host, org };
}
const meetingBody = (extra = {}) => ({
  title: 'Client review',
  description: 'Design conversation',
  scheduledAt: '2027-01-15T10:00:00.000Z',
  durationMinutes: 45,
  timeZone: 'Asia/Dubai',
  access: 'link',
  invitees: [],
  ...extra,
});
test('scheduled link shows company branding, waits for host, starts early, and reconnects only to its session', async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const created = await f.call('POST', `/api/orgs/${f.org.id}/meetings`, meetingBody(), f.host);
  assert.equal(created.statusCode, 201, created.body);
  const m = created.json();
  const preview = (await f.call('GET', `/api/meet/${m.code}`)).json();
  assert.equal(preview.organization.name, 'Element8');
  assert.equal(preview.invitees, undefined);
  assert.equal(preview.createdBy, undefined);
  const joined = await f.call('POST', `/api/meet/${m.code}/join`, { name: 'Client' });
  assert.equal(joined.statusCode, 200, joined.body);
  const guest = joined.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  assert.equal(joined.json().state, 'waiting');
  assert.equal((await f.call('POST', `/api/meet/${m.code}/connection`, {}, guest)).statusCode, 409);
  const starts = await Promise.all([
    f.call('POST', `/api/orgs/${f.org.id}/meetings/${m.id}/start`, {}, f.host),
    f.call('POST', `/api/orgs/${f.org.id}/meetings/${m.id}/start`, {}, f.host),
  ]);
  assert.equal(starts[0].statusCode, 200);
  assert.equal(starts[0].json().sessionId, starts[1].json().sessionId);
  assert.equal((await f.call('POST', `/api/meet/${m.code}/connection`, {}, guest)).statusCode, 200);
  assert.equal(
    (await f.call('POST', `/api/orgs/${f.org.id}/meetings/${m.id}/end`, {}, guest)).statusCode,
    401,
  );
  assert.equal(
    (await f.call('POST', `/api/orgs/${f.org.id}/meetings/${m.id}/end`, {}, f.host)).statusCode,
    200,
  );
  assert.equal((await f.call('POST', `/api/meet/${m.code}/connection`, {}, guest)).statusCode, 409);
  const restart = (
    await f.call('POST', `/api/orgs/${f.org.id}/meetings/${m.id}/restart`, {}, f.host)
  ).json();
  assert.notEqual(restart.sessionId, starts[0].json().sessionId);
  assert.equal((await f.call('POST', `/api/meet/${m.code}/connection`, {}, guest)).statusCode, 403);
  assert.equal(
    (await f.call('POST', `/api/meet/${m.code}/join`, { name: 'Client' }, guest)).statusCode,
    200,
  );
});
test('invite-only access requires verified invited email; tenant and moderation permissions are enforced', async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const m = (
    await f.call(
      'POST',
      `/api/orgs/${f.org.id}/meetings`,
      meetingBody({ access: 'invited', invitees: ['client@example.com'] }),
      f.host,
    )
  ).json();
  assert.equal(
    (
      await f.call('POST', `/api/meet/${m.code}/join`, {
        name: 'Impostor',
        email: 'client@example.com',
      })
    ).statusCode,
    401,
  );
  const outsider = await f.login('uninvited@example.com');
  assert.equal(
    (await f.call('POST', `/api/meet/${m.code}/join`, { name: 'Outside' }, outsider)).statusCode,
    403,
  );
  const client = await f.login('client@example.com');
  assert.equal(
    (await f.call('POST', `/api/meet/${m.code}/join`, { name: 'Client' }, client)).statusCode,
    200,
  );
  assert.equal(
    (await f.call('GET', `/api/orgs/${f.org.id}/meetings`, undefined, client)).statusCode,
    403,
  );
  assert.equal(
    (await f.call('POST', `/api/orgs/${f.org.id}/meetings/${m.id}/start`, {}, client)).statusCode,
    403,
  );
  await f.call('POST', `/api/orgs/${f.org.id}/meetings/${m.id}/start`, {}, f.host);
  const state = (await f.call('GET', `/api/meet/${m.code}/session`, undefined, client)).json();
  assert.equal(state.attendee.email, 'client@example.com');
  await f.call('POST', `/api/meet/${m.code}/join`, { name: 'Host' }, f.host);
  const chat = await f.call('POST', `/api/meet/${m.code}/chat`, { body: 'Hello client' }, f.host);
  assert.equal(chat.statusCode, 201, chat.body);
  assert.equal(
    (await f.call('GET', `/api/meet/${m.code}/chat`, undefined, client)).json()[0].body,
    'Hello client',
  );
  assert.equal(
    (await f.call('GET', `/api/meet/${m.code}/chat`, undefined, outsider)).statusCode,
    403,
  );
  assert.equal(
    (await f.call('POST', `/api/meet/${m.code}/remove`, { attendeeId: state.attendee.id }, client))
      .statusCode,
    403,
  );
  assert.equal(
    (await f.call('POST', `/api/meet/${m.code}/remove`, { attendeeId: state.attendee.id }, f.host))
      .statusCode,
    200,
  );
  assert.equal(
    (await f.call('POST', `/api/meet/${m.code}/connection`, {}, client)).statusCode,
    403,
  );
  assert.equal(
    (await f.call('POST', `/api/meet/${m.code}/join`, { name: 'Client' }, client)).statusCode,
    403,
  );
});
test('cancelled links cannot join, another organization cannot access a meeting, invalid schedules are rejected', async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const second = (
    await f.call(
      'POST',
      '/api/orgs',
      { name: 'Other', slug: 'other', managerEmail: 'other@example.com' },
      f.owner,
    )
  ).json();
  const other = await f.login('other@example.com');
  const m = (await f.call('POST', `/api/orgs/${f.org.id}/meetings`, meetingBody(), f.host)).json();
  assert.equal(
    (await f.call('POST', `/api/orgs/${second.id}/meetings/${m.id}/start`, {}, other)).statusCode,
    404,
  );
  assert.equal(
    (
      await f.call(
        'POST',
        `/api/orgs/${f.org.id}/meetings`,
        meetingBody({ scheduledAt: 'no date' }),
        f.host,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await f.call('POST', `/api/orgs/${f.org.id}/meetings/${m.id}/cancel`, {}, f.host)).statusCode,
    200,
  );
  assert.equal(
    (await f.call('POST', `/api/meet/${m.code}/join`, { name: 'Late guest' })).statusCode,
    410,
  );
});

test('removing a membership that has never signed in does not revoke anonymous meeting guests', async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const added = (
    await f.call(
      'POST',
      `/api/orgs/${f.org.id}/members`,
      { email: 'never-signed-in@example.com', role: 'member' },
      f.host,
    )
  ).json();
  const m = (await f.call('POST', `/api/orgs/${f.org.id}/meetings`, meetingBody(), f.host)).json();
  await f.call('POST', `/api/orgs/${f.org.id}/meetings/${m.id}/start`, {}, f.host);
  const joined = await f.call('POST', `/api/meet/${m.code}/join`, { name: 'Anonymous client' });
  const guest = joined.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  assert.equal(
    (await f.call('DELETE', `/api/orgs/${f.org.id}/members/${added.id}`, undefined, f.host))
      .statusCode,
    200,
  );
  assert.equal(
    (await f.call('GET', `/api/meet/${m.code}/session`, undefined, guest)).statusCode,
    200,
  );
  assert.equal(f.mediaCalls.length, 0);
});

test('membership revocation removes only current media-session identities after restart', async (t) => {
  const f = await setup();
  t.after(() => f.app.close());
  const member = (
    await f.call(
      'POST',
      `/api/orgs/${f.org.id}/members`,
      { email: 'participant@example.com', role: 'member' },
      f.host,
    )
  ).json();
  const person = await f.login('participant@example.com');
  const m = (await f.call('POST', `/api/orgs/${f.org.id}/meetings`, meetingBody(), f.host)).json();
  await f.call('POST', `/api/orgs/${f.org.id}/meetings/${m.id}/start`, {}, f.host);
  await f.call('POST', `/api/meet/${m.code}/join`, { name: 'Participant' }, person);
  await f.call('POST', `/api/orgs/${f.org.id}/meetings/${m.id}/end`, {}, f.host);
  await f.call('POST', `/api/orgs/${f.org.id}/meetings/${m.id}/restart`, {}, f.host);
  const joined = (
    await f.call('POST', `/api/meet/${m.code}/join`, { name: 'Participant' }, person)
  ).json();
  f.mediaCalls.length = 0;
  assert.equal(
    (await f.call('DELETE', `/api/orgs/${f.org.id}/members/${member.id}`, undefined, f.host))
      .statusCode,
    200,
  );
  assert.equal(f.mediaCalls.length, 1);
  assert.ok(f.mediaCalls[0].endsWith(joined.attendee.id));
  assert.equal(
    (await f.call('POST', `/api/meet/${m.code}/connection`, {}, person)).statusCode,
    403,
  );
});
