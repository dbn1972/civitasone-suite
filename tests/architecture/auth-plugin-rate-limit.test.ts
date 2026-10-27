/**
 * CodeQL js/missing-rate-limiting (#20): packages/auth/src/plugin.ts authenticates every request,
 * so every service that registers it must register @civitasone/rate-limit AFTER it (req.ctx is
 * populated by then) and never blanket-trust X-Forwarded-For so req.ip cannot be forged.
 *
 * Run: pnpm exec vitest run tests/architecture/auth-plugin-rate-limit.test.ts
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SERVICES = join(__dirname, "..", "..", "services");

const registering = readdirSync(SERVICES)
  .map((d) => ({ d, file: join(SERVICES, d, "src", "app.ts") }))
  .filter(({ file }) => existsSync(file))
  .map(({ d, file }) => ({ d, src: readFileSync(file, "utf8") }))
  .filter(({ src }) => /app\.register\(authPlugin\b/.test(src));

describe("every service that registers authPlugin rate-limits its routes", () => {
  it("finds the auth-plugin services (guard against a vacuous pass)", () => {
    expect(registering.length).toBeGreaterThan(40);
  });

  it.each(registering.map(({ d, src }) => [d, src] as const))("%s registers rate-limit after authPlugin, without blanket trustProxy", (_d, src) => {
    const auth = src.search(/app\.register\(authPlugin\b/);
    const rl = src.search(/registerRateLimit\(\s*app\b/);
    expect(rl, "registerRateLimit(app, ...) missing").toBeGreaterThan(-1);
    expect(rl, "rate limiter must be registered after authPlugin").toBeGreaterThan(auth);
    expect(src).toMatch(/from "@civitasone\/rate-limit"/);
    // never blanket-trust X-Forwarded-For (an external caller could forge req.ip and dodge the limiter)
    expect(src).not.toMatch(/trustProxy:\s*true/);
  });
});
