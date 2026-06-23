import { defineConfig, devices } from '@playwright/test';

const MOCK_GATEWAY_PORT = 4001;
const MOCK_GATEWAY_URL = `http://127.0.0.1:${MOCK_GATEWAY_PORT}`;
const E2E_PORT = process.env.E2E_PORT ? parseInt(process.env.E2E_PORT, 10) : 4100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'e2e-report' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${E2E_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  globalSetup: './e2e/global-setup',
  globalTeardown: './e2e/global-teardown',
  webServer: {
    command: `CIVITASONE_API_BASE_URL=${MOCK_GATEWAY_URL} pnpm --filter @civitasone/web dev --port ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
