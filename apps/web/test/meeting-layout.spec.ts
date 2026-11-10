import { test, expect } from '@playwright/test';
test('meeting details occupy their own full-width line without squeezing meeting titles or actions', async ({
  page,
}) => {
  const org = {
    id: 'layout-org',
    name: 'Element8',
    slug: 'layout-org',
    role: 'manager',
    color: '#1c5947',
    logoDataUrl: '',
    timeZone: 'Asia/Dubai',
  };
  const meetings = [
    {
      id: 'layout-meeting',
      orgId: org.id,
      code: 'layout-code',
      title: 'Discovery Call',
      scheduledAt: new Date().toISOString(),
      durationMinutes: 30,
      timeZone: 'Asia/Dubai',
      access: 'link',
      invitees: [],
      status: 'scheduled',
      canHost: true,
    },
  ];
  await page.route('**/api/me', (r) =>
    r.fulfill({
      json: {
        user: { id: 'layout-user', name: 'Manager', email: 'manager@example.com' },
        platformAdmin: false,
        organizations: [org],
      },
    }),
  );
  await page.route('**/api/orgs/layout-org/meetings', (r) => r.fulfill({ json: meetings }));
  await page.route('**/api/meet/layout-code/recordings', (r) =>
    r.fulfill({ json: { enabled: true, recordings: [] } }),
  );
  await page.goto('/');
  const row = page.locator('.meeting-row').first();
  const details = row.locator('.meeting-recordings');
  for (const language of ['en', 'ar']) {
    if (language === 'ar') await page.getByRole('button', { name: 'Switch to Arabic' }).click();
    for (const width of [1280, 900, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const open of [false, true]) {
        if ((await details.evaluate((el) => (el as HTMLDetailsElement).open)) !== open)
          await details.locator('summary').click();
        const boxes = await row.evaluate((el) => {
          const rect = (selector: string) => {
            const b = el.querySelector(selector)!.getBoundingClientRect();
            return { x: b.x, y: b.y, width: b.width, bottom: b.bottom };
          };
          const r = el.getBoundingClientRect();
          return {
            row: { x: r.x, width: r.width },
            date: rect('.date-tile'),
            title: rect('.meeting-details'),
            details: rect('.meeting-recordings'),
          };
        });
        expect(boxes.details.width).toBeGreaterThanOrEqual(boxes.row.width - 2);
        expect(boxes.details.y).toBeGreaterThanOrEqual(boxes.date.bottom);
        if (width >= 900) expect(boxes.title.width).toBeGreaterThan(200);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await page.screenshot({
        path: `.superpowers/meeting-list-${language}-${width}.png`,
        fullPage: true,
      });
    }
  }
});
