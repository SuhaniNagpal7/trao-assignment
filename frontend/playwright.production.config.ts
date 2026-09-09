import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './production-tests', workers: 1, timeout: 90000,
  use: { baseURL: process.env.SMOKE_URL || 'https://localhost:3443', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', ignoreHTTPSErrors: true, trace: 'retain-on-failure' },
  reporter: 'list',
});
