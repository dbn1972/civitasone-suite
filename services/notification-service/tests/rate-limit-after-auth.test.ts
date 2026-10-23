/**
 * CLOS2-S6-01: the default rate-limit key reads req.ctx.tenantId, which authPlugin sets in
 * its onRequest hook. Hooks run in registration order, so authPlugin must be registered
 * BEFORE registerRateLimit or the key silently degrades to per-IP.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("notification-service app: auth before rate-limit", () => {
  it("registers authPlugin before registerRateLimit", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/app.ts", import.meta.url)), "utf8");
    const auth = src.indexOf("app.register(authPlugin)");
    const limit = src.indexOf("registerRateLimit(app");
    expect(auth).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(-1);
    expect(auth).toBeLessThan(limit);
  });
});
