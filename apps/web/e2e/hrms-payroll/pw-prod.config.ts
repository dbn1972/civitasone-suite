import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 1,
  workers: 2,
  timeout: 45_000,
  reporter: [['list']],
  globalSetup: '../global-setup',
  globalTeardown: '../global-teardown',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'off',
    ignoreHTTPSErrors: true,
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{
    name: 'desktop-chromium',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  }],
});
