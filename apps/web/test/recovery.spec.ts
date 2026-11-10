import { test, expect } from '@playwright/test';

// Exercise the actual MeetingPage/recovery controller with only the SFU boundary
// replaced. The real two-browser media test separately covers SDK lifecycle.
const roomBoundary = `
import React from '/node_modules/.vite/deps/react.js';
export function MeetingRoom(props) {
  React.useEffect(() => { props.onConnected(); }, [props.connection.token]);
  return React.createElement('main', {},
    React.createElement('h1', {}, 'Joined room'),
    props.reconnecting && React.createElement('p', { role: 'status' }, 'Reconnecting to the meeting…'),
    ...[['Drop network', undefined], ['Removed', 4], ['Duplicate', 2]].map(([name, reason]) =>
      React.createElement('button', { key: name, onClick: () => props.onDisconnected(reason) }, name)),
    React.createElement('button', { onClick: props.onLeave }, 'Leave'),
    React.createElement('output', {}, props.connection.token));
}`;
async function setup(page: import('@playwright/test').Page) {
  let session: any = {
    title: 'Recovery test',
    status: 'live',
    access: 'link',
    durationMinutes: 30,
    organization: { name: 'Local company', slug: 'local', color: '#123456' },
    scheduledAt: new Date().toISOString(),
    timeZone: 'UTC',
    sessionId: 'original',
    attendee: { id: 'guest', name: 'Guest', raised: false },
    participants: [],
    mediaReady: true,
  };
  let sessionStatus = 200;
  const calls = { join: 0, leave: 0, connection: 0 };
  await page.route('**/src/MeetingRoom.tsx*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: roomBoundary }),
  );
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 401, json: { error: 'Sign in required.' } }),
  );
  await page.route('**/api/meet/recovery**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/join')) {
      calls.join++;
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith('/leave')) {
      calls.leave++;
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith('/session'))
      return route.fulfill({
        status: sessionStatus,
        json: sessionStatus === 200 ? session : { error: 'Removed' },
      });
    if (path.endsWith('/connection')) {
      calls.connection++;
      return route.fulfill({
        json: { sessionId: 'original', url: 'ws://local', token: `token-${calls.connection}` },
      });
    }
    return route.fulfill({ json: session });
  });
  await page.goto('/o/local/meet/recovery');
  await page.getByLabel('Your name').fill('Guest');
  await page.getByRole('button', { name: 'Join meeting', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Joined room' })).toBeVisible();
  return {
    calls,
    change: (next: any, status = 200) => {
      session = { ...session, ...next };
      sessionStatus = status;
    },
  };
}
test('terminal network recovery obtains a fresh token without join or leave', async ({ page }) => {
  const { calls } = await setup(page);
  await page.getByRole('button', { name: 'Drop network' }).click();
  await expect(page.locator('p[role="status"]')).toHaveText('Reconnecting to the meeting…');
  await expect(page.locator('output')).toHaveText('token-2');
  expect(calls).toEqual({ join: 1, leave: 0, connection: 2 });
});
for (const change of [{ status: 'ended' }, { sessionId: 'restarted' }, { removed: true }])
  test(`does not reconnect after authority changes ${JSON.stringify(change)}`, async ({ page }) => {
    const { calls, change: update } = await setup(page);
    update(change, change.removed ? 403 : 200);
    await page.getByRole('button', { name: 'Drop network' }).click();
    await expect(page.getByRole('heading', { name: 'Joined room' })).toHaveCount(0);
    expect(calls).toEqual({ join: 1, leave: 0, connection: 1 });
  });
for (const reason of ['Removed', 'Duplicate'])
  test(`does not fight ${reason}`, async ({ page }) => {
    const { calls } = await setup(page);
    await page.getByRole('button', { name: reason, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Joined room' })).toHaveCount(0);
    await page.waitForTimeout(2800);
    expect(calls).toEqual({ join: 1, leave: 0, connection: 1 });
  });
test('explicit leave cancels pending network recovery', async ({ page }) => {
  const { calls } = await setup(page);
  await page.getByRole('button', { name: 'Drop network' }).click();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Join meeting', exact: true })).toBeVisible();
  await page.waitForTimeout(2800);
  expect(calls).toEqual({ join: 1, leave: 1, connection: 1 });
});

test('leaving while a manual connection is pending never reuses its late token', async ({
  page,
}) => {
  const { calls } = await setup(page);
  await page.getByRole('button', { name: 'Removed', exact: true }).click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let pending = false;
  await page.route('**/api/meet/recovery/connection', async (route) => {
    pending = true;
    await held;
    await route.fulfill({
      json: { sessionId: 'original', url: 'ws://local', token: 'stale-manual-token' },
    });
    complete();
  });
  await page.getByRole('button', { name: 'Connect to room', exact: true }).click();
  await expect.poll(() => pending).toBe(true);
  await page.getByRole('button', { name: 'Leave meeting', exact: true }).click();
  release();
  await completed;
  await page.unroute('**/api/meet/recovery/connection');
  await expect(page.getByRole('button', { name: 'Join meeting', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Join meeting', exact: true }).click();
  await expect(page.locator('output')).toHaveText('token-2');
  expect(calls).toEqual({ join: 2, leave: 1, connection: 2 });
});
