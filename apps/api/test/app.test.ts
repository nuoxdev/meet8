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

test('code requests never expose email verification codes outside development mode', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const result = await f.call('POST', '/api/auth/request', {
    email: 'safe@example.com',
    name: 'Safe',
  });
  assert.equal(result.json().code, undefined);
  assert.equal(result.json().developmentCode, undefined);
});

test('expired verification challenges and exhausted guesses cannot establish sessions', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  await f.call('POST', '/api/auth/request', { email: 'expired@example.com', name: 'Expired' });
  const code = f.sent.at(-1)!.code;
  await f.store.transaction((s) => {
    s.challenges.find((c) => c.email === 'expired@example.com')!.expiresAt = Date.now() - 1;
  });
  assert.equal(
    (await f.call('POST', '/api/auth/verify', { email: 'expired@example.com', code })).statusCode,
    401,
  );
  await f.call('POST', '/api/auth/request', { email: 'guessed@example.com', name: 'Guessed' });
  const valid = f.sent.at(-1)!.code;
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await f.call('POST', '/api/auth/verify', {
          email: 'guessed@example.com',
          code: 'not-valid',
        })
      ).statusCode,
      401,
    );
  assert.equal(
    (await f.call('POST', '/api/auth/verify', { email: 'guessed@example.com', code: valid }))
      .statusCode,
    401,
  );
});

test('configured proxy trusts only the closest forwarding hop and default mode ignores forwarding headers', async (t) => {
  const a = await fixture({ trustedProxyIP: '127.0.0.1' });
  const b = await fixture();
  t.after(async () => {
    await a.app.close();
    await b.app.close();
  });
  a.app.get('/test-client-ip', (r) => ({ ip: r.ip }));
  b.app.get('/test-client-ip', (r) => ({ ip: r.ip }));
  const header = { 'x-forwarded-for': '198.51.100.99, 203.0.113.12' };
  assert.equal(
    (await a.app.inject({ url: '/test-client-ip', headers: header })).json().ip,
    '203.0.113.12',
  );
  assert.notEqual(
    (await b.app.inject({ url: '/test-client-ip', headers: header })).json().ip,
    '203.0.113.12',
  );
});
test('one workshop network can register and verify 100 distinct attendees without exhausting shared-IP sign-in limits', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  for (let i = 0; i < 100; i++) {
    const email = `attendee${i}@example.com`;
    const request = await f.call('POST', '/api/auth/request', { email, name: `Attendee ${i}` });
    assert.equal(request.statusCode, 200, `request ${i}: ${request.body}`);
    const code = f.sent.at(-1)!.code;
    const verify = await f.call('POST', '/api/auth/verify', { email, code });
    assert.equal(verify.statusCode, 200, `verify ${i}: ${verify.body}`);
  }
});
test('repeated unverified code requests are throttled without invalidating the first code', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  await f.call('POST', '/api/auth/request', { email: 'repeat@example.com', name: 'Repeat' });
  const code = f.sent.at(-1)!.code;
  assert.equal(
    (await f.call('POST', '/api/auth/request', { email: 'repeat@example.com', name: 'Repeat' }))
      .statusCode,
    429,
  );
  assert.equal(
    (await f.call('POST', '/api/auth/verify', { email: 'repeat@example.com', code })).statusCode,
    200,
  );
  assert.equal(f.sent.length, 1);
});
