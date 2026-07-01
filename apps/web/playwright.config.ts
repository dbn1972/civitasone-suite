// CI runs chromium only. To run the full device matrix locally:
// pnpm --filter @civitasone/web exec playwright test --project=firefox,webkit,tablet-portrait,mobile-portrait
import { defineConfig, devices } from '@playwright/test';

const MOCK_GATEWAY_PORT = 4001;
const MOCK_GATEWAY_URL = `http://127.0.0.1:${MOCK_GATEWAY_PORT}`;
const E2E_PORT = process.env.E2E_PORT ? parseInt(process.env.E2E_PORT, 10) : 4100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  reporter: [['html', { outputFolder: 'e2e-report' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${E2E_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Desktop browsers
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Tablet
    { name: 'tablet-portrait', use: { ...devices['iPad (gen 7)'] } },
    { name: 'tablet-landscape', use: { ...devices['iPad (gen 7) landscape'] } },
    // Mobile
    { name: 'mobile-portrait', use: { ...devices['iPhone 14'] } },
    { name: 'mobile-landscape', use: { ...devices['iPhone 14 landscape'] } },
  ],
  globalSetup: './e2e/global-setup',
  globalTeardown: './e2e/global-teardown',
  webServer: {
    command: `CIVITASONE_API_BASE_URL=${MOCK_GATEWAY_URL} pnpm --filter @civitasone/web dev --port ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
