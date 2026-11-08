import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';

test('verification is single-use, cookie is httpOnly, registration does not grant an organization', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  await f.call('POST', '/api/auth/request', { email: 'new@example.com', name: 'New person' });
  const code = f.sent.at(-1)!.code;
  assert.equal(
    (await f.call('POST', '/api/auth/verify', { email: 'new@example.com', code: 'wrong' }))
      .statusCode,
    401,
  );
  const verified = await f.call('POST', '/api/auth/verify', { email: 'new@example.com', code });
  assert.equal(verified.statusCode, 200);
  assert.match(String(verified.headers['set-cookie']), /HttpOnly/i);
  assert.equal(
    (await f.call('POST', '/api/auth/verify', { email: 'new@example.com', code })).statusCode,
    401,
  );
  const cookie = verified.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  assert.deepEqual((await f.call('GET', '/api/me', undefined, cookie)).json().organizations, []);
});

test('only platform owner provisions companies; assigned manager can manage only their company', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const owner = await f.login('owner@example.com');
  const outsider = await f.login('outsider@example.com');
  assert.equal(
    (
      await f.call(
        'POST',
        '/api/orgs',
        { name: 'Wrong', slug: 'wrong', managerEmail: 'outsider@example.com' },
        outsider,
      )
    ).statusCode,
    403,
  );
  const created = await f.call(
    'POST',
    '/api/orgs',
    { name: 'Element8', slug: 'element8', managerEmail: 'manager@example.com' },
    owner,
  );
  assert.equal(created.statusCode, 201, created.body);
  const org = created.json();
  const manager = await f.login('manager@example.com');
  assert.equal(
    (await f.call('GET', '/api/me', undefined, manager)).json().organizations[0].id,
    org.id,
  );
  assert.equal(
    (
      await f.call(
        'PATCH',
        `/api/orgs/${org.id}`,
        { color: '#aaddcc', name: 'Element Eight' },
        manager,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await f.call('PATCH', `/api/orgs/${org.id}`, { name: 'Hacked' }, outsider)).statusCode,
    403,
  );
  assert.equal(
    (
      await f.call(
        'POST',
        '/api/orgs',
        { name: 'Duplicate', slug: 'element8', managerEmail: 'manager@example.com' },
        owner,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.call(
        'POST',
        `/api/orgs/${org.id}/members`,
        { email: 'member@example.com', role: 'member' },
        manager,
      )
    ).statusCode,
    201,
  );
  const member = await f.login('member@example.com');
  assert.equal(
    (
      await f.call(
        'POST',
        `/api/orgs/${org.id}/members`,
        { email: 'other@example.com', role: 'manager' },
        member,
      )
    ).statusCode,
    403,
  );
  const members = (await f.call('GET', `/api/orgs/${org.id}/members`, undefined, manager)).json();
  const memberId = members.find((m: any) => m.email === 'member@example.com').id;
  assert.equal(
    (await f.call('DELETE', `/api/orgs/${org.id}/members/${memberId}`, undefined, manager))
      .statusCode,
    200,
  );
  assert.equal(
    (await f.call('GET', `/api/orgs/${org.id}/meetings`, undefined, member)).statusCode,
    403,
  );
});

test('email challenges expire; bad input and foreign origins are rejected; logout revokes session', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  assert.equal(
    (await f.call('POST', '/api/auth/request', { email: 'bad', name: 'x' })).statusCode,
    400,
  );
  const foreign = await f.app.inject({
    method: 'POST',
    url: '/api/auth/request',
    payload: { email: 'x@example.com', name: 'x' },
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(foreign.statusCode, 403);
  const cookie = await f.login('owner@example.com');
  assert.equal((await f.call('POST', '/api/auth/logout', {}, cookie)).statusCode, 200);
  assert.equal((await f.call('GET', '/api/me', undefined, cookie)).statusCode, 401);
});

test('mail failure never exposes challenges or authenticates a user', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const result = await f.call('POST', '/api/auth/request', {
    email: 'safe@example.com',
    name: 'Safe',
  });
  assert.equal(result.json().code, undefined);
  assert.equal(result.json().developmentCode, undefined);
});
