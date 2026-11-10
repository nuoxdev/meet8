import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { brandStyle } from '../../web/src/branding.js';

test('organization palette persists, validates colors and follows public workshop links without leaking another company palette', async (t) => {
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
  const a = await create('brand-a');
  const b = await create('brand-b');
  const manager = await f.login('brand-a@example.com');
  const palette = { color: '#2233aa', secondaryColor: '#6c286f', accentColor: '#ffcc22' };
  const saved = await f.call('PATCH', `/api/orgs/${a.id}`, palette, manager);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().secondaryColor, palette.secondaryColor);
  assert.equal(saved.json().accentColor, palette.accentColor);
  assert.equal((await f.call('PATCH', `/api/orgs/${b.id}`, palette, manager)).statusCode, 403);
  for (const field of ['color', 'secondaryColor', 'accentColor']) {
    assert.equal(
      (await f.call('PATCH', `/api/orgs/${a.id}`, { [field]: 'red;display:none' }, manager))
        .statusCode,
      400,
    );
  }
  const me = (await f.call('GET', '/api/me', undefined, manager)).json();
  assert.equal(me.organizations[0].accentColor, palette.accentColor);
  const meeting = (
    await f.call(
      'POST',
      `/api/orgs/${a.id}/meetings`,
      {
        title: 'Customer workshop',
        scheduledAt: new Date().toISOString(),
        durationMinutes: 60,
        timeZone: 'Asia/Dubai',
        access: 'link',
        invitees: [],
      },
      manager,
    )
  ).json();
  const preview = (await f.call('GET', `/api/meet/${meeting.code}`)).json();
  assert.equal(preview.organization.secondaryColor, palette.secondaryColor);
  assert.equal(preview.organization.accentColor, palette.accentColor);
  const other = (await f.call('GET', '/api/me', undefined, owner))
    .json()
    .organizations.find((o: any) => o.id === b.id);
  assert.notEqual(other.secondaryColor, palette.secondaryColor);
});

test('palette has safe legacy defaults and readable foregrounds even for very light brand colors', () => {
  const legacy = brandStyle('#2233aa') as Record<string, string>;
  assert.match(legacy['--brand-secondary'], /^#[a-f0-9]{6}$/i);
  assert.match(legacy['--brand-accent'], /^#[a-f0-9]{6}$/i);
  const light = brandStyle('#ffffff', '#ffffee', '#ffffff') as Record<string, string>;
  assert.equal(light['--brand-ink'], '#000000');
  assert.equal(light['--brand-secondary-ink'], '#000000');
  assert.equal(light['--brand-accent-ink'], '#000000');
  assert.equal(
    (brandStyle('url(evil)', 'red', 'bad') as Record<string, string>)['--brand'],
    '#1c5947',
  );
});
