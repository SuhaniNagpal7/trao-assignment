import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './walkthrough', workers: 1, timeout: 600000,
  use: { baseURL: 'http://localhost:3000', browserName: 'chromium', channel: 'msedge', viewport: { width: 1366, height: 900 }, video: { mode: 'on', size: { width: 1366, height: 900 } } },
  reporter: 'list',
});
