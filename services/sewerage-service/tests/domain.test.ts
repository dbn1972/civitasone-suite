/**
 * Pure unit tests for the state-machine validators in each module's
 * domain.ts. No DB / queue / HTTP involved — these just prove the transition
 * tables are internally consistent and, specifically, that every terminal
 * write route this service exposes is actually reachable from the initial
 * state through the commands/routes that exist.
 *
 * Regression coverage for the bug fixed in this pass: complaints/domain.ts
 * previously required "in_progress" before "resolved", but no command/route
 * ever produced "in_progress", so POST .../resolve always 422'd. See
 * tests/complaints-flow.integration.test.ts for the live end-to-end proof
 * against a real DB.
 */
import { describe, it, expect } from "vitest";
import { validateAppTransition, validateConnTransition } from "../src/modules/connections/domain.js";
import { validateBillTransition } from "../src/modules/billing/domain.js";
import { validateComplaintTransition } from "../src/modules/complaints/domain.js";
import { validateBookingTransition } from "../src/modules/desludging/domain.js";

describe("connections/domain — application transitions", () => {
  it("walks the full reachable path submitted → activated", () => {
    expect(validateAppTransition("submitted", "feasibility_check")).toBeNull();
    expect(validateAppTransition("feasibility_check", "estimate_issued")).toBeNull();
    expect(validateAppTransition("estimate_issued", "payment_pending")).toBeNull();
    expect(validateAppTransition("payment_pending", "work_ordered")).toBeNull();
    expect(validateAppTransition("work_ordered", "activated")).toBeNull();
  });

  it("rejects skipping a stage", () => {
    expect(validateAppTransition("submitted", "work_ordered")).toMatch(/invalid( bill)? transition/);
  });

  it("activated and rejected are terminal", () => {
    expect(validateAppTransition("activated", "submitted")).toMatch(/invalid( bill)? transition/);
    expect(validateAppTransition("rejected", "submitted")).toMatch(/invalid( bill)? transition/);
  });

  it("connection status: active ↔ suspended, both → disconnected (terminal)", () => {
    expect(validateConnTransition("active", "suspended")).toBeNull();
    expect(validateConnTransition("suspended", "active")).toBeNull();
    expect(validateConnTransition("active", "disconnected")).toBeNull();
    expect(validateConnTransition("disconnected", "active")).toMatch(/invalid( bill)? transition/);
  });
});

describe("billing/domain — bill transitions", () => {
  it("walks generated → sent → paid", () => {
    expect(validateBillTransition("generated", "sent")).toBeNull();
    expect(validateBillTransition("sent", "paid")).toBeNull();
  });

  it("overdue can still be paid", () => {
    expect(validateBillTransition("overdue", "paid")).toBeNull();
  });

  it("paid is terminal", () => {
    expect(validateBillTransition("paid", "sent")).toMatch(/invalid( bill)? transition/);
  });
});

describe("desludging/domain — booking transitions", () => {
  it("walks requested → scheduled → dispatched → completed", () => {
    expect(validateBookingTransition("requested", "scheduled")).toBeNull();
    expect(validateBookingTransition("scheduled", "dispatched")).toBeNull();
    expect(validateBookingTransition("dispatched", "completed")).toBeNull();
  });

  it("cancellable from requested, scheduled, and dispatched", () => {
    expect(validateBookingTransition("requested", "cancelled")).toBeNull();
    expect(validateBookingTransition("scheduled", "cancelled")).toBeNull();
    expect(validateBookingTransition("dispatched", "cancelled")).toBeNull();
  });

  it("completed and cancelled are terminal", () => {
    expect(validateBookingTransition("completed", "cancelled")).toMatch(/invalid( bill)? transition/);
    expect(validateBookingTransition("cancelled", "scheduled")).toMatch(/invalid( bill)? transition/);
  });
});

describe("complaints/domain — transitions (regression: resolve reachability)", () => {
  it("reported → assigned is the only entry point", () => {
    expect(validateComplaintTransition("reported", "assigned")).toBeNull();
    expect(validateComplaintTransition("reported", "resolved")).toMatch(/invalid( bill)? transition/);
  });

  it("BUG (fixed): assigned → resolved must be reachable — no command ever sets in_progress", () => {
    // Before the fix, TRANSITIONS.assigned was ["in_progress", "closed"], and
    // nothing in this service ever transitions a complaint to "in_progress"
    // (topics.ts / routes.ts have no such command), so this always failed and
    // POST /v1/sewerage/complaints/:id/resolve was permanently unreachable.
    expect(validateComplaintTransition("assigned", "resolved")).toBeNull();
  });

  it("assigned → closed still works (direct close without resolution)", () => {
    expect(validateComplaintTransition("assigned", "closed")).toBeNull();
  });

  it("in_progress → resolved still valid, for forward-compatibility if a future change adds that transition", () => {
    expect(validateComplaintTransition("in_progress", "resolved")).toBeNull();
  });

  it("resolved → closed is the final step", () => {
    expect(validateComplaintTransition("resolved", "closed")).toBeNull();
  });

  it("closed is terminal", () => {
    expect(validateComplaintTransition("closed", "assigned")).toMatch(/invalid( bill)? transition/);
  });
});
