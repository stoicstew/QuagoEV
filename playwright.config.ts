import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'ui.spec.ts', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4201', viewport: { width: 1365, height: 1000 }, channel: 'chrome', trace: 'retain-on-failure' },
  webServer: { command: 'npx vite --host 127.0.0.1 --port 4201', url: 'http://127.0.0.1:4201', reuseExistingServer: !process.env.CI },
  reporter: [['list']],
});
