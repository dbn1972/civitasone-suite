/**
 * Playwright config for the HRMS + Payroll E2E test suite.
 *
 * Runs across:
 * - 3 browsers (Chromium, Firefox, WebKit)
 * - 3 viewports (Desktop 1440×900, Tablet 768×1024, Mobile 375×812)
 *
 * Run: pnpm --filter @civitasone/web exec playwright test --config e2e/hrms-payroll/playwright.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

const E2E_PORT = process.env.E2E_PORT ? parseInt(process.env.E2E_PORT, 10) : 4100;
const MOCK_GATEWAY_URL = `http://127.0.0.1:4001`;

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  timeout: 30_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  reporter: [
    ['html', { outputFolder: '../../hrms-payroll-report', open: 'never' }],
    ['junit', { outputFile: '../../hrms-payroll-results.xml' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${E2E_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    // ── Desktop (1440×900) ─────────────────────────────────────────────
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'desktop-firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'desktop-webkit',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 900 },
      },
    },
    // ── Tablet (768×1024) ──────────────────────────────────────────────
    {
      name: 'tablet-chromium',
      use: {
        ...devices['iPad (gen 7)'],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: 'tablet-firefox',
      use: {
        browserName: 'firefox',
        viewport: { width: 768, height: 1024 },
        isMobile: false,
      },
    },
    {
      name: 'tablet-webkit',
      use: {
        ...devices['iPad (gen 7)'],
        viewport: { width: 768, height: 1024 },
      },
    },
    // ── Mobile (375×812) ───────────────────────────────────────────────
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: 'mobile-firefox',
      use: {
        browserName: 'firefox',
        viewport: { width: 375, height: 812 },
        isMobile: true,
      },
    },
    {
      name: 'mobile-webkit',
      use: {
        ...devices['iPhone 14'],
        viewport: { width: 375, height: 812 },
      },
    },
  ],
  globalSetup: '../global-setup',
  globalTeardown: '../global-teardown',
  webServer: {
    command: `CIVITASONE_API_BASE_URL=${MOCK_GATEWAY_URL} pnpm --filter @civitasone/web dev --port ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: true,
    timeout: 300_000,
    ignoreHTTPSErrors: true,
  },
});
