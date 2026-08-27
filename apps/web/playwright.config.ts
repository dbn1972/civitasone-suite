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
    // Two separate, compounding bugs made this hang for the full timeout,
    // every time, no matter how high the timeout was raised (verified up to
    // 400_000ms on 2026-08-27):
    //
    // 1. `next dev` never reaches "Ready" in this CI environment -- webpack
    //    logs a couple of PackFileCacheStrategy warnings about next-intl's
    //    dynamic `import(t)` and then goes silent forever. `next start`
    //    against a build made moments earlier has none of this (Ready in
    //    ~490ms), so CI builds once, as its own step (see ci.yml's "Build
    //    web" step in the e2e / procurement-e2e jobs -- chaining `build &&
    //    start` into this command instead put the ~3.5min build time inside
    //    webServer's own timeout and blew through 360s), and this command
    //    only has to do the fast `next start`.
    //
    // 2. Independent of (1): Playwright's `webServer.url` readiness check
    //    requires a non-redirect response. Every route in this app redirects
    //    (307) an unauthenticated request -- including `/` and `/auth/login`
    //    -- by design (middleware.ts). So even a server that is already up
    //    and responding in milliseconds (confirmed directly: curl against a
    //    freshly-started `next start` on this exact port returns a clean 307
    //    in ~20ms) never satisfies a `url`-based check; Playwright just
    //    retries silently until its timeout. Proved in isolation: pointing a
    //    throwaway webServer config with `url` at an already-running, already
    //    -responding server still timed out after 10s, while switching that
    //    same config to `port` succeeded in under 2s. `port` only checks that
    //    the TCP port accepts connections, which is what "is the server up"
    //    actually means here -- exactly parallel to the fix already applied
    //    to the Accessibility job's `wait-on http://.../auth/login` (switched
    //    to `wait-on tcp:localhost:3000` for the same reason).
    //
    // Local runs keep `next dev` for hot reload; global-setup.ts has no
    // NODE_ENV/dev-login dependency, so switching modes only in CI is safe.
    command: process.env.CI
      ? `CIVITASONE_API_BASE_URL=${MOCK_GATEWAY_URL} pnpm --filter @civitasone/web run start --port ${E2E_PORT}`
      : `CIVITASONE_API_BASE_URL=${MOCK_GATEWAY_URL} pnpm --filter @civitasone/web dev --port ${E2E_PORT}`,
    port: E2E_PORT,
    reuseExistingServer: !process.env.CI,
    // `next start` against an already-built .next/ is fast (~490ms observed);
    // 120s leaves ample margin either way without hiding a real regression.
    timeout: 120_000,
  },
});
