import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
test('company pages expose branding only and custom addresses remain unique and cannot shadow system routes', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const owner = await f.login('owner@example.com');
  const create = async (slug: string) =>
    (
      await f.call(
        'POST',
        '/api/orgs',
        { name: slug, slug, managerEmail: `${slug}@example.com` },
        owner,
      )
    ).json();
  const a = await create('company-a');
  const b = await create('company-b');
  const manager = await f.login('company-a@example.com');
  const saved = await f.call('PATCH', `/api/orgs/${a.id}`, { pageSlug: 'element8' }, manager);
  assert.equal(saved.statusCode, 200, saved.body);
  const publicPage = await f.call('GET', '/api/organizations/element8');
  assert.equal(publicPage.statusCode, 200, publicPage.body);
  assert.equal(publicPage.json().name, 'company-a');
  assert.equal(publicPage.json().id, undefined);
  assert.equal(publicPage.json().memberships, undefined);
  assert.equal(publicPage.json().meetings, undefined);
  assert.equal((await f.call('GET', '/api/organizations/company-a')).statusCode, 200);
  assert.equal(
    (await f.call('PATCH', `/api/orgs/${b.id}`, { pageSlug: 'element8' }, owner)).statusCode,
    409,
  );
  assert.equal(
    (await f.call('PATCH', `/api/orgs/${a.id}`, { pageSlug: 'api' }, manager)).statusCode,
    400,
  );
  assert.equal(
    (
      await f.call(
        'POST',
        '/api/orgs',
        { name: 'Bad', slug: 'assets', managerEmail: 'x@example.com' },
        owner,
      )
    ).statusCode,
    400,
  );
  assert.equal((await f.call('GET', '/api/organizations/missing')).statusCode, 404);
  assert.equal(
    (await f.call('PATCH', `/api/orgs/${b.id}`, { pageSlug: 'other' }, manager)).statusCode,
    403,
  );
});
