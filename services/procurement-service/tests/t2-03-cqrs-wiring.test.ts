import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const publish = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...args: unknown[]) => publish(...args) },
  cache: { invalidate: vi.fn(), makeKey: (...parts: string[]) => parts.join(":") },
}));

describe("T2-03 procurement CQRS wiring", () => {
  beforeEach(() => publish.mockClear());

  it("three-way-match and vendor-blacklist routes have no db sync writes", () => {
    for (const rel of ["three-way-match/routes.ts", "vendor-blacklist/routes.ts"]) {
      const src = readFileSync(resolve(__dirname, `../src/modules/${rel}`), "utf8");
      expect(src).not.toMatch(/\bdb\.(transaction|insert|update|delete)\s*\(/);
    }
  });

  it("worker registers both consumers", () => {
    const worker = readFileSync(resolve(__dirname, "../src/worker.ts"), "utf8");
    expect(worker).toContain("registerThreeWayMatchConsumers(queue)");
    expect(worker).toContain("registerVendorBlacklistConsumers(queue)");
  });

  it("commands publish expected topics", async () => {
    const ctx = {
      tenantId: "aaaaaaaa-1111-4000-8000-000000000001",
      actorId: "bbbbbbbb-2222-4000-8000-000000000001",
      correlationId: "corr-1",
      roles: ["procurement_admin"],
    } as any;
    const twm = await import("../src/modules/three-way-match/commands.js");
    await twm.runThreeWayMatch(ctx, {
      poId: "cccccccc-3333-4000-8000-000000000001",
      grnId: "dddddddd-4444-4000-8000-000000000001",
    });
    expect(publish.mock.calls.at(-1)![0]).toBe("procurement.three_way_match.run");

    const vb = await import("../src/modules/vendor-blacklist/commands.js");
    await vb.addVendorBlacklist(ctx, "eeeeeeee-5555-4000-8000-000000000001", {
      reason: "GFR violation",
      blacklistedFrom: "2026-01-01",
    });
    expect(publish.mock.calls.at(-1)![0]).toBe("procurement.vendor_blacklist.add");
  });
});
