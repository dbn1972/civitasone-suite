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
    // Width 1280 sits above the documented 1024px responsive floor.
    //
    // Height is deliberately 2000, not a realistic 900: the sidebar is a long
    // scrollable nav, and at 900px its lower items are clipped. axe then cannot
    // compute their background and returns them as `incomplete` ("partially
    // obscured by another element") rather than pass/fail. Since this gate treats
    // undecided-at-serious-impact as blocking, a short viewport manufactured ~50
    // undecidable checks that were measurement artifacts rather than defects. A
    // tall viewport makes the contrast computation decidable, which is the point.
    viewport: { width: 1280, height: 2000 },
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
