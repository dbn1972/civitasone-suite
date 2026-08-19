import { defineConfig, devices } from "@playwright/test";

/**
 * Task 40 — staging smoke-run config. Deliberately separate from
 * playwright.config.ts: that config's globalSetup starts a local
 * docker-compose stack and points baseURL at localhost:3000, neither of
 * which apply when the target is the real staging deployment.
 */
export default defineConfig({
  testDir: "./specs",
  testMatch: /staging-smoke-scaled\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 120_000,
  use: {
    baseURL: "https://civitasone.65-2-205-201.nip.io",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    headless: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
