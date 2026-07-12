import { describe, it, expect } from "vitest";
import {
  nextStatus,
  pendingMigrations,
  migrationsConfirmed,
  canTransitionToReady,
  isProvisionStatus,
} from "../src/modules/provisioning/domain.js";

// ══════════════════════════════════════════════════════════════════════════════
// Minimal coverage-raising tests for the provisioning state machine (task 7.1).
// The full property-test coverage (idempotency/resumability, state-machine
// invariant) is planned separately under tasks 7.2/7.3, and concrete-example
// coverage under 7.4. This file only exercises the happy-path transitions,
// a couple of illegal-transition no-ops, and the migration-diff helpers so
// domain.ts isn't left at 0% coverage in the interim.
// ══════════════════════════════════════════════════════════════════════════════

describe("nextStatus", () => {
  it("requested + start -> provisioning", () => {
    expect(nextStatus("requested", { type: "start" })).toBe("provisioning");
  });

  it("provisioning + complete(confirmed) -> ready", () => {
    expect(nextStatus("provisioning", { type: "complete", migrationsConfirmed: true })).toBe("ready");
  });

  it("provisioning + complete(not confirmed) -> stays provisioning", () => {
    expect(nextStatus("provisioning", { type: "complete", migrationsConfirmed: false })).toBe("provisioning");
  });

  it("provisioning + fail -> failed", () => {
    expect(nextStatus("provisioning", { type: "fail" })).toBe("failed");
  });

  it("provisioning + retry -> provisioning", () => {
    expect(nextStatus("provisioning", { type: "retry" })).toBe("provisioning");
  });

  it("failed + retry -> provisioning", () => {
    expect(nextStatus("failed", { type: "retry" })).toBe("provisioning");
  });

  it("requested + retry is a no-op", () => {
    expect(nextStatus("requested", { type: "retry" })).toBe("requested");
  });

  it("ready + any action is a no-op (terminal)", () => {
    expect(nextStatus("ready", { type: "start" })).toBe("ready");
    expect(nextStatus("ready", { type: "fail" })).toBe("ready");
    expect(nextStatus("ready", { type: "retry" })).toBe("ready");
  });
});

describe("pendingMigrations", () => {
  it("returns migrations not yet applied, preserving order", () => {
    expect(pendingMigrations(["m1", "m2", "m3"], ["m1"])).toEqual(["m2", "m3"]);
  });

  it("returns empty when all migrations applied", () => {
    expect(pendingMigrations(["m1", "m2"], ["m1", "m2"])).toEqual([]);
  });

  it("returns all migrations when none applied", () => {
    expect(pendingMigrations(["m1", "m2"], [])).toEqual(["m1", "m2"]);
  });
});

describe("migrationsConfirmed / canTransitionToReady", () => {
  it("is true when every required migration is applied", () => {
    const record = { requiredMigrations: ["m1", "m2"], appliedMigrations: ["m1", "m2"] };
    expect(migrationsConfirmed(record)).toBe(true);
    expect(canTransitionToReady(record)).toBe(true);
  });

  it("is false when a required migration is missing", () => {
    const record = { requiredMigrations: ["m1", "m2"], appliedMigrations: ["m1"] };
    expect(migrationsConfirmed(record)).toBe(false);
    expect(canTransitionToReady(record)).toBe(false);
  });
});

describe("isProvisionStatus", () => {
  it("recognises valid statuses", () => {
    expect(isProvisionStatus("requested")).toBe(true);
    expect(isProvisionStatus("ready")).toBe(true);
  });

  it("rejects unknown strings", () => {
    expect(isProvisionStatus("bogus")).toBe(false);
  });
});
