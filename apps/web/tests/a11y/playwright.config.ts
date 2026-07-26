import { defineConfig, devices } from "@playwright/test";

/**
 * Accessibility gate config.
 *
 * Assumes the web app is already running (pm2 fleet locally, or a CI job that
 * builds and starts it). It deliberately does NOT define a `webServer` that
 * silently starts a dev server: a dev-mode build renders differently from
 * production (React strict-mode double-render, no minification, dev overlays
 * that inject their own DOM), and auditing the wrong build is a false result.
 */
export default defineConfig({
  testDir: __dirname,
  testMatch: /a11y\.spec\.ts/,
  // Violations must be deterministic — no retries masking a flaky pass.
  retries: 0,
  // axe is CPU-bound; more than 4 workers starves the Next.js server and causes
  // timeouts that look like a11y failures.
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "a11y-results.json" }]]
    : [["list"]],
  use: {
    baseURL: process.env.A11Y_BASE_URL ?? "http://localhost:3000",
    ...devices["Desktop Chrome"],
    // 1024px is the documented minimum supported width (GIGW responsive floor).
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
