import { defineConfig, devices } from "@playwright/test";

/**
 * Live UAT E2E suite — runs against the deployed CivitasOne environment at
 * https://civitasone.65-2-205-201.nip.io (no mocked backend, no webServer
 * bring-up). This is a smoke suite validating that the real Keycloak +
 * gateway + services + Next.js chain works end-to-end after infra fixes.
 *
 * Run: pnpm --filter @civitasone/web exec playwright test --config e2e-uat-live/playwright.config.ts
 */
const BASE_URL = process.env.UAT_BASE_URL ?? "https://civitasone.65-2-205-201.nip.io";

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { outputFolder: "uat-live-report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    // Self-signed nginx cert on the nip.io host.
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Video recording adds a heavy ffmpeg + extra chromium process per test
    // and was the direct cause of intermittent "browser has been closed"
    // failures in this environment; keep it off for this live smoke suite.
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // No webServer block: this suite targets an already-running deployment.
});
