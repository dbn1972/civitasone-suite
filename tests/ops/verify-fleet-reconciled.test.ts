/**
 * Unit tests for `verify-fleet-reconciled.mjs`'s `diffFleet()` (Issue #3:
 * deployment-runbook reconciliation).
 *
 * Exercises `diffFleet()` directly with in-memory `pm2 jlist`-shaped fixtures
 * — no live pm2 daemon required. Mirrors
 * tests/ops/verify-pgbouncer-routing.test.ts's shape (same family of script,
 * same reason it lives here).
 *
 * NOTE: lives under tests/ops/ (not scripts/ops/tests/) because the root
 * vitest.config.mjs only includes "tests/**\/*.test.ts" — see
 * tests/ops/verify-pgbouncer-routing.test.ts's own header for the same note.
 */
import { describe, it, expect } from "vitest";
import { diffFleet } from "../../scripts/ops/verify-fleet-reconciled.mjs";

function onlineProc(name) {
  return { name, pm2_env: { status: "online" } };
}
function proc(name, status) {
  return { name, pm2_env: { status } };
}

describe("verify-fleet-reconciled: diffFleet() — fully reconciled fleet", () => {
  it("reports nothing missing, not-online, or duplicated when every declared app is online exactly once", () => {
    const declared = ["identity", "tenant", "finance-worker", "web"];
    const pm2List = declared.map(onlineProc);

    const { missing, notOnline, duplicated } = diffFleet(declared, pm2List);

    expect(missing).toEqual([]);
    expect(notOnline).toEqual([]);
    expect(duplicated).toEqual([]);
  });

  it("ignores pm2 processes that aren't declared (e.g. an ad hoc debug process)", () => {
    const declared = ["identity"];
    const pm2List = [onlineProc("identity"), onlineProc("someones-debug-script")];

    const { missing, notOnline, duplicated } = diffFleet(declared, pm2List);

    expect(missing).toEqual([]);
    expect(notOnline).toEqual([]);
    expect(duplicated).toEqual([]);
  });
});

describe("verify-fleet-reconciled: diffFleet() — the exact regression this exists to catch", () => {
  it("flags a declared app PM2 has never heard of as MISSING, not merely not-online", () => {
    // The Issue #3 repro shape: 100 of 132 declared apps were never started —
    // pm2 jlist simply has no entry for them at all.
    const declared = ["identity", "tenant", "works", "metadata"];
    const pm2List = [onlineProc("identity"), onlineProc("tenant")];

    const { missing, notOnline } = diffFleet(declared, pm2List);

    expect(missing.sort()).toEqual(["metadata", "works"]);
    expect(notOnline).toEqual([]);
  });

  it("flags a declared app PM2 knows about but that isn't online as NOT-ONLINE, distinct from missing", () => {
    const declared = ["identity", "court"];
    const pm2List = [onlineProc("identity"), proc("court", "stopped")];

    const { missing, notOnline } = diffFleet(declared, pm2List);

    expect(missing).toEqual([]);
    expect(notOnline).toEqual([{ name: "court", status: "stopped" }]);
  });

  it("treats 'errored' (a crash-looped, gave-up process) the same as any other non-online status", () => {
    const declared = ["payroll"];
    const pm2List = [proc("payroll", "errored")];

    const { notOnline } = diffFleet(declared, pm2List);

    expect(notOnline).toEqual([{ name: "payroll", status: "errored" }]);
  });

  it("flags more than one online instance under the same declared name as DUPLICATED", () => {
    const declared = ["gateway"];
    const pm2List = [onlineProc("gateway"), onlineProc("gateway")];

    const { missing, notOnline, duplicated } = diffFleet(declared, pm2List);

    expect(missing).toEqual([]);
    expect(notOnline).toEqual([]);
    expect(duplicated).toEqual(["gateway"]);
  });

  it("a totally empty pm2 list flags every declared app as missing", () => {
    const declared = ["identity", "tenant", "finance"];

    const { missing, notOnline, duplicated } = diffFleet(declared, []);

    expect(missing).toEqual(declared);
    expect(notOnline).toEqual([]);
    expect(duplicated).toEqual([]);
  });

  it("handles a null/undefined pm2 process list defensively rather than throwing", () => {
    expect(() => diffFleet(["identity"], undefined)).not.toThrow();
    expect(diffFleet(["identity"], undefined).missing).toEqual(["identity"]);
  });

  it("mixed fleet: simultaneously reports missing, not-online, duplicated and clean apps independently", () => {
    const declared = ["identity", "tenant", "court", "works", "gateway"];
    const pm2List = [
      onlineProc("identity"),
      onlineProc("tenant"),
      proc("court", "stopped"),
      onlineProc("gateway"),
      onlineProc("gateway"),
      // "works" absent entirely
    ];

    const { missing, notOnline, duplicated } = diffFleet(declared, pm2List);

    expect(missing).toEqual(["works"]);
    expect(notOnline).toEqual([{ name: "court", status: "stopped" }]);
    expect(duplicated).toEqual(["gateway"]);
  });
});
