import { defineConfig, devices } from "@playwright/test";

/**
 * Gate #4 — Autonomous Persona E2E.
 *
 * Each test logs in as a specific persona, navigates their modules, performs a
 * representative create+read flow, and asserts: no 4xx/5xx, no dead-end pages,
 * data persists and renders correctly.
 *
 * Requires: web (:3000), gateway (:8080), and the pm2 service fleet running.
 */
export default defineConfig({
  testDir: __dirname,
  testMatch: /\.persona\.ts$/,
  retries: 0,
  workers: 1, // journeys are stateful (create then read) — serialized
  timeout: 120_000,
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "persona-e2e-results.json" }]]
    : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
