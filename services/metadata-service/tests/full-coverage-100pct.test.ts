import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural guard: metadata-service is now a real runnable service (not a
 * schema-only stub). Verifies its module surface and that the app entrypoint
 * exists.
 */
describe("metadata — config & extensibility (real service)", () => {
  const src = join(__dirname, "../src");

  it("has an app entrypoint and worker", () => {
    expect(existsSync(join(src, "app.ts"))).toBe(true);
    expect(existsSync(join(src, "worker.ts"))).toBe(true);
  });

  it("exposes the config/extensibility modules", () => {
    const mods = readdirSync(join(src, "modules"));
    for (const m of ["entities", "rules", "fields", "layouts", "records", "formula", "composition", "preview"]) {
      expect(mods).toContain(m);
    }
  });

  // Dynamic import of app.ts pulls the full Fastify + module graph. Under CI
  // contention (parallel service suites sharing a runner) this routinely
  // exceeds vitest's 5s default — give it headroom without slowing the suite.
  it("buildApp is importable", async () => {
    const mod = await import("../src/app.js");
    expect(typeof mod.buildApp).toBe("function");
  }, 30_000);
});
