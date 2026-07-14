/**
 * Concrete-example unit tests for `domain.ts`'s Silo_Provisioning_Record
 * state machine transitions (task 7.4).
 *
 * Complements `provisioning-domain.property.test.ts` (Properties 5/6) with
 * specific, named legal/illegal action-pair examples plus the "resume only
 * accepted from `failed` (or stale `provisioning`)" boundary case.
 *
 * Validates: Requirements 4.3
 */
import { describe, it, expect } from "vitest";
import { nextStatus, canTransitionToReady, migrationsConfirmed, pendingMigrations } from "../src/modules/provisioning/domain.js";

describe("domain.ts — legal transition examples", () => {
  it("requested + start -> provisioning", () => {
    expect(nextStatus("requested", { type: "start" })).toBe("provisioning");
  });

  it("provisioning + complete(migrationsConfirmed: true) -> ready", () => {
    expect(nextStatus("provisioning", { type: "complete", migrationsConfirmed: true })).toBe("ready");
  });

  it("provisioning + fail -> failed", () => {
    expect(nextStatus("provisioning", { type: "fail" })).toBe("failed");
  });

  it("provisioning + retry -> provisioning (idempotent resume of a stale in-flight attempt)", () => {
    expect(nextStatus("provisioning", { type: "retry" })).toBe("provisioning");
  });

  it("failed + retry -> provisioning (Req 4.3 resume)", () => {
    expect(nextStatus("failed", { type: "retry" })).toBe("provisioning");
  });
});

describe("domain.ts — illegal action-pair examples (no-ops)", () => {
  it("requested + retry is a no-op (retry not accepted before a start has ever occurred)", () => {
    expect(nextStatus("requested", { type: "retry" })).toBe("requested");
  });

  it("requested + fail is a no-op (cannot fail a record that hasn't started provisioning)", () => {
    expect(nextStatus("requested", { type: "fail" })).toBe("requested");
  });

  it("requested + complete is a no-op (cannot complete before provisioning starts)", () => {
    expect(nextStatus("requested", { type: "complete", migrationsConfirmed: true })).toBe("requested");
  });

  it("provisioning + complete(migrationsConfirmed: false) is a no-op — stays provisioning for a subsequent retry", () => {
    expect(nextStatus("provisioning", { type: "complete", migrationsConfirmed: false })).toBe("provisioning");
  });

  it("provisioning + start is a no-op (already past the requested->provisioning transition)", () => {
    expect(nextStatus("provisioning", { type: "start" })).toBe("provisioning");
  });

  it("failed + start is a no-op (must resume via retry, not start)", () => {
    expect(nextStatus("failed", { type: "start" })).toBe("failed");
  });

  it("failed + complete is a no-op (a failed record cannot directly complete)", () => {
    expect(nextStatus("failed", { type: "complete", migrationsConfirmed: true })).toBe("failed");
  });

  it("failed + fail is a no-op (already failed)", () => {
    expect(nextStatus("failed", { type: "fail" })).toBe("failed");
  });

  it("ready + start/fail/retry/complete are all no-ops — ready is terminal", () => {
    expect(nextStatus("ready", { type: "start" })).toBe("ready");
    expect(nextStatus("ready", { type: "fail" })).toBe("ready");
    expect(nextStatus("ready", { type: "retry" })).toBe("ready");
    expect(nextStatus("ready", { type: "complete", migrationsConfirmed: true })).toBe("ready");
    expect(nextStatus("ready", { type: "complete", migrationsConfirmed: false })).toBe("ready");
  });
});

describe("domain.ts — resume boundary: only accepted from `failed` (or stale `provisioning`)", () => {
  it("retry from `failed` is accepted and transitions to `provisioning`", () => {
    expect(nextStatus("failed", { type: "retry" })).toBe("provisioning");
  });

  it("retry from a stale in-flight `provisioning` record is accepted (idempotent resume, stays `provisioning`)", () => {
    expect(nextStatus("provisioning", { type: "retry" })).toBe("provisioning");
  });

  it("retry from `requested` is NOT accepted — a record must have started at least once before it can resume", () => {
    expect(nextStatus("requested", { type: "retry" })).toBe("requested");
  });

  it("retry from `ready` is NOT accepted — a fully-provisioned record never resumes", () => {
    expect(nextStatus("ready", { type: "retry" })).toBe("ready");
  });
});

describe("domain.ts — migrationsConfirmed / canTransitionToReady concrete examples", () => {
  it("migrationsConfirmed is true when appliedMigrations covers every requiredMigrations entry", () => {
    const record = { requiredMigrations: ["svc-a/0001.sql", "svc-b/0001.sql"], appliedMigrations: ["svc-a/0001.sql", "svc-b/0001.sql"] };
    expect(migrationsConfirmed(record)).toBe(true);
    expect(canTransitionToReady(record)).toBe(true);
    expect(pendingMigrations(record.requiredMigrations, record.appliedMigrations)).toEqual([]);
  });

  it("migrationsConfirmed is false when one required migration is still missing", () => {
    const record = { requiredMigrations: ["svc-a/0001.sql", "svc-b/0001.sql"], appliedMigrations: ["svc-a/0001.sql"] };
    expect(migrationsConfirmed(record)).toBe(false);
    expect(canTransitionToReady(record)).toBe(false);
    expect(pendingMigrations(record.requiredMigrations, record.appliedMigrations)).toEqual(["svc-b/0001.sql"]);
  });

  it("migrationsConfirmed is vacuously true when requiredMigrations is empty", () => {
    const record = { requiredMigrations: [], appliedMigrations: [] };
    expect(migrationsConfirmed(record)).toBe(true);
    expect(canTransitionToReady(record)).toBe(true);
  });

  it("extra entries in appliedMigrations beyond requiredMigrations do not affect the confirmation result", () => {
    const record = { requiredMigrations: ["svc-a/0001.sql"], appliedMigrations: ["svc-a/0001.sql", "svc-unrelated/0099.sql"] };
    expect(migrationsConfirmed(record)).toBe(true);
  });
});
