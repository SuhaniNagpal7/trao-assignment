import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { baseURL: 'http://localhost:3000', browserName: 'chromium', channel: 'msedge', trace: 'retain-on-failure' },
  reporter: 'list'
});
