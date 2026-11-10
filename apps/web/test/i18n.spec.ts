import { test, expect } from '@playwright/test';

test('language switch persists and translates sign-in with RTL layout', async ({ page }) => {
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 401, json: { error: 'Sign in required.' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to Meet8.' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Arabic' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'أهلاً بك في Meet8.' })).toBeVisible();
  await expect(page.getByLabel('البريد الإلكتروني', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to English' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'إرسال رمز الدخول' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('button', { name: 'Send sign-in code' })).toBeVisible();
});

test('Arabic dashboard, settings and scheduler preserve organization content', async ({ page }) => {
  const organization = {
    id: 'localization-org',
    slug: 'i18n-company',
    name: 'Element8',
    role: 'manager',
    color: '#1c5947',
    logoDataUrl: '',
    timeZone: 'Asia/Dubai',
  };
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: {
        user: { id: 'localization-user', name: 'Localization Manager', email: 'i18n@example.com' },
        platformAdmin: false,
        organizations: [organization],
      },
    }),
  );
  await page.route('**/api/orgs/localization-org/meetings', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/orgs/localization-org/members', (route) => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to Arabic' }).click();
  await expect(page.getByRole('button', { name: 'جدولة اجتماع' })).toBeVisible();
  await expect(page.getByText('Localization Manager', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'جدولة اجتماع' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('عنوان الاجتماع', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'إنشاء الاجتماع', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
  await page.getByRole('button', { name: 'المؤسسة', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'هوية المؤسسة' })).toBeVisible();
  await expect(page.getByLabel('اللون الأساسي', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to English' })).toBeVisible();
});

test('Arabic guest joining, waiting room and organization welcome use translated React content', async ({
  page,
}) => {
  const organization = {
    slug: 'local-workshop',
    pageSlug: 'customer-workshops',
    name: 'Element8',
    color: '#1c5947',
    logoDataUrl: '',
  };
  const preview = {
    code: 'localization-meeting-code',
    title: 'Customer workshop',
    scheduledAt: '2027-01-12T08:00:00Z',
    durationMinutes: 60,
    timeZone: 'Asia/Dubai',
    access: 'link',
    status: 'scheduled',
    organization,
  };
  await page.addInitScript(() => localStorage.setItem('meet8-language', 'ar'));
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 401, json: { error: 'Please sign in to continue.' } }),
  );
  await page.route('**/api/meet/localization-meeting-code', (route) =>
    route.fulfill({ json: preview }),
  );
  await page.route('**/api/meet/localization-meeting-code/join', (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route('**/api/meet/localization-meeting-code/session', (route) =>
    route.fulfill({
      json: {
        ...preview,
        participants: [],
        canHost: false,
        canModerate: false,
        mediaReady: false,
        attendee: { id: 'arabic-guest', name: 'أحمد', raised: false },
      },
    }),
  );
  await page.route('**/api/organizations/customer-workshops', (route) =>
    route.fulfill({ json: organization }),
  );
  await page.goto('/o/local-workshop/meet/localization-meeting-code');
  await expect(page.getByRole('heading', { name: 'Customer workshop' })).toBeVisible();
  await expect(page.getByText('باستضافة Element8', { exact: true })).toBeVisible();
  await page.getByLabel('اسمك', { exact: true }).fill('أحمد');
  await page.getByRole('button', { name: 'الانضمام إلى الاجتماع', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'بانتظار المضيف' })).toBeVisible();
  await expect(page.getByText('ستنضم تلقائياً عندما يبدأ المضيف الاجتماع.')).toBeVisible();
  await page.getByRole('link', { name: /Element8.*meet8/ }).click();
  await expect(page).toHaveURL('/customer-workshops');
  await expect(page.getByRole('heading', { name: 'أهلاً بك لدى Element8' })).toBeVisible();
  await expect(page.getByLabel('رابط الاجتماع أو رمزه')).toBeVisible();
});

test('guest co-host can switch language and use RTL host controls without changing participant names', async ({
  page,
}) => {
  const code = 'localization-cohost-code';
  const preview = {
    code,
    title: 'Customer workshop',
    scheduledAt: '2027-01-12T08:00:00Z',
    durationMinutes: 60,
    timeZone: 'Asia/Dubai',
    access: 'link',
    status: 'live',
    organization: { slug: 'local-workshop', name: 'Element8', color: '#1c5947', logoDataUrl: '' },
  };
  const attendee = { id: 'guest-cohost', name: 'Guest Facilitator', raised: false };
  const session = {
    ...preview,
    sessionId: 'localization-session',
    attendee,
    participants: [{ ...attendee, isCohost: true }],
    canHost: false,
    canModerate: true,
    canAssignCohost: false,
    mediaReady: true,
    settings: {
      microphoneAccess: 'everyone',
      cameraAccess: 'everyone',
      screenShareAccess: 'everyone',
      chatEnabled: true,
      locked: false,
    },
  };
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 401, json: { error: 'Please sign in to continue.' } }),
  );
  await page.route(`**/api/meet/${code}`, (route) => route.fulfill({ json: preview }));
  await page.route(`**/api/meet/${code}/join`, (route) => route.fulfill({ json: { ok: true } }));
  await page.route(`**/api/meet/${code}/session`, (route) => route.fulfill({ json: session }));
  await page.route(`**/api/meet/${code}/chat`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/meet/${code}/connection`, (route) =>
    route.fulfill({
      json: {
        url: 'ws://localhost:17898',
        token: 'localization-only-token',
        sessionId: 'localization-session',
      },
    }),
  );
  // Keep signaling in its connecting state: these checks concern translated UI,
  // not a real media session or backend moderation authority.
  await page.routeWebSocket('ws://localhost:17898/**', () => {});
  await page.goto(`/o/local-workshop/meet/${code}`);
  await page.getByLabel('Your name', { exact: true }).fill('Guest Facilitator');
  await page.getByRole('button', { name: 'Join meeting', exact: true }).click();
  await page.getByRole('button', { name: 'Host controls', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Workshop permissions' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Arabic' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('button', { name: 'أدوات المضيف', exact: true })).toBeVisible();
  await expect(page.getByLabel('صلاحية استخدام الميكروفون')).toBeVisible();
  await expect(page.getByLabel('منع انضمام حاضرين جدد')).toBeVisible();
  await page.getByRole('button', { name: '1 مشارك', exact: true }).click();
  await expect(page.getByText('Guest Facilitator', { exact: false })).toBeVisible();
  await expect(page.getByText('مضيف مشارك', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'إنهاء الاجتماع للجميع' })).toHaveCount(0);
});

test('a current guest co-host can reopen completed meeting recordings without joining media again', async ({
  page,
}) => {
  const code = 'completed-cohost-workshop';
  const preview = {
    code,
    title: 'Completed customer workshop',
    scheduledAt: new Date().toISOString(),
    durationMinutes: 60,
    timeZone: 'Asia/Dubai',
    access: 'link',
    status: 'ended',
    organization: { name: 'Workshop Company', slug: 'workshop', color: '#334477', logoDataUrl: '' },
  };
  await page.route('**/api/me', (r) => r.fulfill({ status: 401, json: { error: 'Sign in' } }));
  await page.route(`**/api/meet/${code}`, (r) => r.fulfill({ json: preview }));
  await page.route(`**/api/meet/${code}/session`, (r) =>
    r.fulfill({
      json: {
        ...preview,
        sessionId: 'finished-session',
        attendee: { id: 'cohost-attendee', name: 'Guest Facilitator', raised: false },
        participants: [],
        canHost: false,
        canModerate: true,
        mediaReady: true,
      },
    }),
  );
  await page.route(`**/api/meet/${code}/recordings`, (r) =>
    r.fulfill({
      json: {
        enabled: true,
        recordings: [
          {
            id: 'saved-recording',
            createdAt: new Date().toISOString(),
            status: 'ready',
            shared: false,
          },
        ],
      },
    }),
  );
  await page.goto(`/o/workshop/meet/${code}`);
  await expect(page.getByRole('region', { name: 'Recordings', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Watch or download', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create share link', exact: true })).toHaveCount(0);
  await expect(page.locator('.live-shell')).toHaveCount(0);
});
