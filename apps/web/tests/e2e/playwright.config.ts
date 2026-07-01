/**
 * Playwright config for the tests/e2e/ test suite.
 *
 * This config focuses on core user flows (smoke, auth, navigation, branding, MSME onboarding)
 * and uses Playwright's page.route() API mocking — no live backends required.
 *
 * Run: pnpm --filter @civitasone/web test:e2e
 * UI:  pnpm --filter @civitasone/web test:e2e:ui
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  reporter: [['html', { outputFolder: '../../playwright-report' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  /* Start the Next.js dev server if not already running */
  webServer: {
    command: 'pnpm --filter @civitasone/web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
