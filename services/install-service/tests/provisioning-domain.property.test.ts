/**
 * Property-based tests for the Silo_Provisioning_Record state machine
 * (tasks 7.2, 7.3).
 *
 * **Property 5: Silo provisioning migration application is idempotent and
 * resumable**
 * **Validates: Requirements 3.3, 3.6, 4.3**
 *
 * **Property 6: Silo_Provisioning_Record state machine invariant**
 * **Validates: Requirements 3.2, 3.8, 4.1, 4.2, 4.5**
 *
 * All functions under test (`domain.ts`) are pure — no I/O — so these
 * properties are checked directly against in-memory arbitraries, no
 * database required.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  nextStatus,
  pendingMigrations,
  migrationsConfirmed,
  canTransitionToReady,
  isProvisionStatus,
  PROVISION_STATUSES,
  type ProvisionStatus,
  type ProvisionAction,
} from "../src/modules/provisioning/domain.js";

const arbStatus = fc.constantFrom(...PROVISION_STATUSES);

const arbAction: fc.Arbitrary<ProvisionAction> = fc.oneof(
  fc.constant({ type: "start" } as const),
  fc.boolean().map((migrationsConfirmed) => ({ type: "complete", migrationsConfirmed }) as const),
  fc.constant({ type: "fail" } as const),
  fc.constant({ type: "retry" } as const),
);

/** Arbitrary migration identifier string. */
const arbMigrationId = fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0);

// ---------------------------------------------------------------------------
// Property 5: Silo provisioning migration application is idempotent and
// resumable — Requirements 3.3, 3.6, 4.3
// ---------------------------------------------------------------------------

describe("Property 5: Silo provisioning migration application is idempotent and resumable", () => {
  it("pendingMigrations(all, applied) is a subset of all, preserving all's original order", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbMigrationId, { minLength: 0, maxLength: 20 }),
        fc.array(arbMigrationId, { minLength: 0, maxLength: 20 }),
        (all, applied) => {
          const pending = pendingMigrations(all, applied);
          // Every pending id is present in `all`, in the same relative order.
          const positionsInAll = pending.map((id) => all.indexOf(id));
          expect(positionsInAll.every((p) => p >= 0)).toBe(true);
          const sorted = [...positionsInAll].sort((a, b) => a - b);
          expect(positionsInAll).toEqual(sorted);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("re-running pendingMigrations with the previous pending set as the new 'all' converges to empty once fully applied (idempotent resume)", () => {
    fc.assert(
      fc.property(fc.uniqueArray(arbMigrationId, { minLength: 0, maxLength: 15 }), (all) => {
        // Simulate a resumed apply loop: start with none applied, then after
        // "applying" the pending diff, re-computing pendingMigrations against
        // the now-fully-applied set yields empty — repeating this idempotent
        // convergence step never re-introduces a previously-applied id.
        let applied: string[] = [];
        let pending = pendingMigrations(all, applied);
        expect(pending).toEqual(all);

        applied = [...applied, ...pending]; // "apply" everything pending
        pending = pendingMigrations(all, applied);
        expect(pending).toEqual([]);

        // A second resume attempt (e.g. a retry racing a not-yet-persisted
        // appliedMigrations update) re-computes the same empty diff — safe,
        // idempotent no-op.
        const secondResume = pendingMigrations(all, applied);
        expect(secondResume).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("duplicate entries in `applied` and reordering never change the pending result (order/duplicate-independence)", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbMigrationId, { minLength: 1, maxLength: 15 }),
        fc.array(fc.integer({ min: 0, max: 14 }), { minLength: 0, maxLength: 30 }),
        (all, appliedIndexPicks) => {
          const appliedOnce = [...new Set(appliedIndexPicks.map((i) => all[i % all.length]))];
          const appliedWithDuplicates = [...appliedOnce, ...appliedOnce, ...appliedOnce].sort(() => Math.random() - 0.5);

          const pendingOnce = pendingMigrations(all, appliedOnce);
          const pendingDup = pendingMigrations(all, appliedWithDuplicates);

          expect(pendingDup).toEqual(pendingOnce);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("migrationsConfirmed is true iff pendingMigrations is empty, and canTransitionToReady mirrors it exactly", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbMigrationId, { minLength: 0, maxLength: 15 }),
        fc.array(arbMigrationId, { minLength: 0, maxLength: 15 }),
        (requiredMigrations, appliedMigrations) => {
          const record = { requiredMigrations, appliedMigrations };
          const pending = pendingMigrations(requiredMigrations, appliedMigrations);

          expect(migrationsConfirmed(record)).toBe(pending.length === 0);
          expect(canTransitionToReady(record)).toBe(migrationsConfirmed(record));
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Silo_Provisioning_Record state machine invariant —
// Requirements 3.2, 3.8, 4.1, 4.2, 4.5
// ---------------------------------------------------------------------------

describe("Property 6: Silo_Provisioning_Record state machine invariant", () => {
  it("nextStatus is total: every (status, action) pair yields a valid ProvisionStatus, never throws", () => {
    fc.assert(
      fc.property(arbStatus, arbAction, (status, action) => {
        let result: ProvisionStatus | undefined;
        expect(() => {
          result = nextStatus(status, action);
        }).not.toThrow();
        expect(isProvisionStatus(result as string)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("ready is terminal: no action ever moves a ready record to a different status", () => {
    fc.assert(
      fc.property(arbAction, (action) => {
        expect(nextStatus("ready", action)).toBe("ready");
      }),
      { numRuns: 100 },
    );
  });

  it("ready is reachable only via a confirmed complete action from provisioning (excluding the reflexive ready->ready no-op)", () => {
    fc.assert(
      fc.property(arbStatus, arbAction, (status, action) => {
        if (status === "ready") return; // reflexive terminal no-op, not a transition INTO ready
        const result = nextStatus(status, action);
        if (result === "ready") {
          expect(status).toBe("provisioning");
          expect(action).toEqual({ type: "complete", migrationsConfirmed: true });
        }
      }),
      { numRuns: 300 },
    );
  });

  it("complete without migrationsConfirmed is always a no-op (never advances past provisioning)", () => {
    fc.assert(
      fc.property(arbStatus, (status) => {
        const action: ProvisionAction = { type: "complete", migrationsConfirmed: false };
        expect(nextStatus(status, action)).toBe(status);
      }),
      { numRuns: 100 },
    );
  });

  it("retry is only meaningful from provisioning or failed; from requested or ready it is a no-op", () => {
    fc.assert(
      fc.property(arbStatus, () => {
        const action: ProvisionAction = { type: "retry" };
        for (const status of PROVISION_STATUSES) {
          const result = nextStatus(status, action);
          if (status === "requested" || status === "ready") {
            expect(result).toBe(status); // no-op
          } else {
            expect(result).toBe("provisioning"); // provisioning->provisioning or failed->provisioning
          }
        }
      }),
      { numRuns: 10 }, // deterministic body — a handful of runs is enough
    );
  });

  it("fail is only meaningful from provisioning; from every other status it is a no-op", () => {
    for (const status of PROVISION_STATUSES) {
      const result = nextStatus(status, { type: "fail" });
      if (status === "provisioning") {
        expect(result).toBe("failed");
      } else {
        expect(result).toBe(status);
      }
    }
  });

  it("start is only meaningful from requested; from every other status it is a no-op", () => {
    for (const status of PROVISION_STATUSES) {
      const result = nextStatus(status, { type: "start" });
      if (status === "requested") {
        expect(result).toBe("provisioning");
      } else {
        expect(result).toBe(status);
      }
    }
  });

  it("canTransitionToReady never depends on the record's transition history — only on migrationsConfirmed", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbMigrationId, { minLength: 0, maxLength: 10 }),
        fc.array(arbMigrationId, { minLength: 0, maxLength: 10 }),
        fc.array(arbAction, { minLength: 0, maxLength: 8 }),
        (requiredMigrations, appliedMigrations, actionHistory) => {
          const record = { requiredMigrations, appliedMigrations };
          const before = canTransitionToReady(record);

          // Replaying an arbitrary sequence of status transitions (which the
          // record itself doesn't track migration progress through) never
          // changes what canTransitionToReady would say for this same
          // requiredMigrations/appliedMigrations pair.
          let status: ProvisionStatus = "requested";
          for (const action of actionHistory) {
            status = nextStatus(status, action);
          }
          void status; // history is exercised for its side-effect-free nature only

          const after = canTransitionToReady(record);
          expect(after).toBe(before);
        },
      ),
      { numRuns: 200 },
    );
  });
});
