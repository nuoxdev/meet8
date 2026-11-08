import { test, expect, type Page } from '@playwright/test';
async function login(page: Page, email: string, name: string) {
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  const code = await page.getByTestId('development-code').textContent();
  await page.getByLabel('Verification code').fill(code!.trim());
  await page.getByRole('button', { name: 'Verify and continue' }).click();
}
test('owner provisions an organization, manager schedules branded meetings, guests wait and invitation-only access is enforced', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await login(page, 'owner@example.com', 'Platform Owner');
  await page.getByRole('button', { name: 'New organization' }).click();
  await page.getByLabel('Company name').fill('Element8');
  await page.getByLabel('Organization address').fill('element8');
  await page.getByLabel('Manager email').fill('manager@example.com');
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next conversation.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await login(page, 'manager@example.com', 'Organization Manager');
  await page.getByRole('button', { name: 'Schedule a meeting' }).click();
  await page.getByLabel('Meeting title').fill('Client design review');
  await page.getByRole('button', { name: 'Create meeting', exact: true }).click();
  await expect(page.getByText('Client design review', { exact: true })).toBeVisible();
  const href = await page
    .getByRole('link', { name: 'Open Client design review' })
    .getAttribute('href');
  expect(href).toContain('/o/element8/meet/');
  const guest = await browser.newContext();
  const gp = await guest.newPage();
  await gp.goto(href!);
  await expect(gp.getByRole('heading', { name: 'Client design review' })).toBeVisible();
  await expect(gp.getByText('Element8', { exact: true }).first()).toBeVisible();
  await gp.getByLabel('Your name').fill('Client Guest');
  await gp.getByRole('button', { name: 'Join meeting', exact: true }).click();
  await expect(gp.getByText('Waiting for the host')).toBeVisible();
  await gp.route('**/api/meet/*/session', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Temporary connection problem. Retrying.' }),
    }),
  );
  await expect(gp.getByRole('alert')).toContainText('Temporary connection problem');
  await expect(gp.getByText('Waiting for the host')).toBeVisible();
  await gp.unroute('**/api/meet/*/session');
  await page.getByRole('button', { name: 'Schedule a meeting' }).click();
  await page.getByLabel('Meeting title').fill('Private review');
  await page.getByLabel('Invited email addresses only').check();
  await page.getByLabel('Invite email addresses').fill('client@example.com');
  await page.getByRole('button', { name: 'Create meeting', exact: true }).click();
  const privateHref = await page
    .getByRole('link', { name: 'Open Private review' })
    .getAttribute('href');
  await gp.goto(privateHref!);
  await expect(gp.getByText('Verify your invited email')).toBeVisible();
  await page.screenshot({ path: 'docs/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/dashboard-mobile.png', fullPage: true });
  await guest.close();
});

test('a delayed save refresh cannot replace another organization’s meeting list', async ({
  page,
}) => {
  await page.goto('/');
  const challenge = await page.request.post('/api/auth/request', {
    data: { email: 'owner@example.com', name: 'Owner' },
  });
  const code = (await challenge.json()).developmentCode;
  await page.request.post('/api/auth/verify', { data: { email: 'owner@example.com', code } });
  const suffix = Date.now();
  const a = await (
    await page.request.post('/api/orgs', {
      data: { name: 'Company A', slug: `a-${suffix}`, managerEmail: 'owner@example.com' },
    })
  ).json();
  const b = await (
    await page.request.post('/api/orgs', {
      data: { name: 'Company B', slug: `b-${suffix}`, managerEmail: 'owner@example.com' },
    })
  ).json();
  const payload = (title: string) => ({
    title,
    description: '',
    scheduledAt: new Date().toISOString(),
    durationMinutes: 30,
    timeZone: 'Asia/Dubai',
    access: 'link',
    invitees: [],
  });
  await page.request.post(`/api/orgs/${a.id}/meetings`, {
    data: payload('Company A private meeting'),
  });
  await page.request.post(`/api/orgs/${b.id}/meetings`, {
    data: payload('Company B private meeting'),
  });
  await page.evaluate((id) => sessionStorage.setItem('meet8-org', id), a.id);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Open Company A private meeting' })).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const intercepted = new Promise<void>((r) => (entered = r));
  await page.route(`**/api/orgs/${a.id}/meetings`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    entered();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await intercepted;
  await page.getByLabel('Select organization').selectOption(b.id);
  await expect(page.getByRole('link', { name: 'Open Company B private meeting' })).toBeVisible();
  const completed = page.waitForResponse((r) => r.url().includes(`/api/orgs/${a.id}/meetings`));
  release();
  await completed;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(page.getByRole('link', { name: 'Open Company A private meeting' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open Company B private meeting' })).toBeVisible();
});

test('dialogs keep keyboard focus inside and close with Escape', async ({ page }) => {
  await page.goto('/');
  const challenge = await page.request.post('/api/auth/request', {
    data: { email: 'owner@example.com', name: 'Owner' },
  });
  await page.request.post('/api/auth/verify', {
    data: { email: 'owner@example.com', code: (await challenge.json()).developmentCode },
  });
  await page.reload();
  await page.getByRole('button', { name: 'New organization' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(
    page.getByRole('button', { name: 'Create organization', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
