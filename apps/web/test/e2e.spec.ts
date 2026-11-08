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
