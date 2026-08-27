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
    // In CI, `next dev` never reaches "Ready": webpack logs a couple of
    // PackFileCacheStrategy warnings about next-intl's dynamic `import(t)`
    // (it can't statically analyze the build dependency) and then the whole
    // process goes silent forever -- confirmed with a temporarily-raised
    // 400_000ms timeout (2026-08-27): it still never came up, so this is a
    // genuine hang, not merely a slow cold compile that a bigger number would
    // fix. `next start` against a build made moments earlier has none of this
    // (Ready in ~490ms). The build itself is done as its own CI step (see
    // ci.yml's "Build web" step in the e2e / procurement-e2e jobs) rather than
    // chained into this command: chaining `build && start` put the ~3.5min
    // build time inside webServer's own timeout budget and blew through 360s
    // (2026-08-27 run) -- keeping the slow part in an ordinary CI step, with
    // its own clearly-visible duration, and leaving webServer only the fast
    // `next start` is both easier to reason about and matches the pattern the
    // Accessibility job already uses successfully. Local runs keep `next dev`
    // for hot reload; global-setup.ts has no NODE_ENV/dev-login dependency, so
    // switching modes only in CI is safe.
    command: process.env.CI
      ? `CIVITASONE_API_BASE_URL=${MOCK_GATEWAY_URL} pnpm --filter @civitasone/web run start --port ${E2E_PORT}`
      : `CIVITASONE_API_BASE_URL=${MOCK_GATEWAY_URL} pnpm --filter @civitasone/web dev --port ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: !process.env.CI,
    // `next start` against an already-built .next/ is fast (~490ms observed);
    // 120s leaves ample margin either way without hiding a real regression.
    timeout: 120_000,
  },
});
