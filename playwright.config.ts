import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'apps/web/test',
  workers: 1,
  timeout: 30000,
  use: {
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    env: {
      MEET8_OWNER_EMAIL: 'owner@example.com',
      MEET8_BASE_URL: 'http://localhost:5173',
      MEET8_EPHEMERAL: 'true',
      MEET8_DEV_MAIL: 'true',
    },
    timeout: 30000,
  },
});
