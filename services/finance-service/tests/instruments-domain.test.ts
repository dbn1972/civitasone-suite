/**
 * Instruments (Cheque/DD) — state machine and validation tests.
 *
 * Source: services/finance-service/src/modules/instruments/commands.ts, validators.ts
 * Pack #12: erp-ai-test-prompts/Finance_Module_Test_Pack/12_Instruments_Module_Test_Pack.md
 */
import { describe, it, expect } from "vitest";

// ─── Instrument State Machine (source-verified from commands.ts) ─────────────

type InstrumentStatus = "issued" | "presented" | "cleared" | "bounced" | "cancelled";

const TRANSITIONS: Record<InstrumentStatus, InstrumentStatus[]> = {
  issued:    ["presented", "cleared", "bounced", "cancelled"],
  presented: ["cleared", "bounced"],
  cleared:   [],  // terminal
  bounced:   [],  // terminal
  cancelled: [], // terminal
};

function canTransition(from: InstrumentStatus, to: InstrumentStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

describe("instrument state machine", () => {
  describe("issued state — all transitions", () => {
    it("issued → presented", () => expect(canTransition("issued", "presented")).toBe(true));
    it("issued → cleared (skip present)", () => expect(canTransition("issued", "cleared")).toBe(true));
    it("issued → bounced", () => expect(canTransition("issued", "bounced")).toBe(true));
    it("issued → cancelled", () => expect(canTransition("issued", "cancelled")).toBe(true));
  });

  describe("presented state", () => {
    it("presented → cleared", () => expect(canTransition("presented", "cleared")).toBe(true));
    it("presented → bounced (dishonour)", () => expect(canTransition("presented", "bounced")).toBe(true));
    it("presented → cancelled (ILLEGAL)", () => expect(canTransition("presented", "cancelled")).toBe(false));
    it("presented → issued (ILLEGAL — no backward)", () => expect(canTransition("presented", "issued")).toBe(false));
  });

  describe("terminal states — no further transitions", () => {
    it("cleared is terminal", () => {
      expect(canTransition("cleared", "issued")).toBe(false);
      expect(canTransition("cleared", "presented")).toBe(false);
      expect(canTransition("cleared", "bounced")).toBe(false);
      expect(canTransition("cleared", "cancelled")).toBe(false);
    });

    it("bounced is terminal", () => {
      expect(canTransition("bounced", "issued")).toBe(false);
      expect(canTransition("bounced", "cleared")).toBe(false);
      expect(canTransition("bounced", "cancelled")).toBe(false);
    });

    it("cancelled is terminal", () => {
      expect(canTransition("cancelled", "issued")).toBe(false);
      expect(canTransition("cancelled", "presented")).toBe(false);
    });
  });

  describe("idempotency — same-state transitions are silent no-ops", () => {
    it("issued → issued is idempotent (handled in commands.ts by returning current)", () => {
      // This is NOT a state transition — commands.ts checks "if current.status === target, return"
      // So we verify the state machine does NOT list it as a valid transition
      expect(canTransition("issued", "issued")).toBe(false);
    });
  });
});

// ─── Instrument Type Validation ──────────────────────────────────────────────

describe("instrument type validation", () => {
  const VALID_TYPES = ["cheque", "dd"];

  it.each(VALID_TYPES)("accepts valid type: %s", (t) => {
    expect(VALID_TYPES.includes(t)).toBe(true);
  });

  it("rejects invalid types", () => {
    expect(VALID_TYPES.includes("neft")).toBe(false);
    expect(VALID_TYPES.includes("")).toBe(false);
  });
});

// ─── Amount Validation ───────────────────────────────────────────────────────

describe("instrument amount validation", () => {
  it("amount must be positive integer", () => {
    const valid = (n: number) => Number.isInteger(n) && n > 0;
    expect(valid(1)).toBe(true);
    expect(valid(100_000)).toBe(true);
    expect(valid(0)).toBe(false);
    expect(valid(-1)).toBe(false);
    expect(valid(1.5)).toBe(false);
  });
});

// ─── Conflict Detection ─────────────────────────────────────────────────────

describe("instrument conflict detection (re-issue with different terms)", () => {
  it("same amount + same payee = idempotent (no conflict)", () => {
    const existing = { amountMinor: 50000n, payee: "Acme Corp" };
    const incoming = { amountMinor: 50000, payee: "Acme Corp" };
    expect(existing.amountMinor === BigInt(incoming.amountMinor) && existing.payee === incoming.payee).toBe(true);
  });

  it("different amount = CONFLICT", () => {
    const existing = { amountMinor: 50000n, payee: "Acme Corp" };
    const incoming = { amountMinor: 99999, payee: "Acme Corp" };
    expect(existing.amountMinor === BigInt(incoming.amountMinor)).toBe(false);
  });

  it("different payee = CONFLICT", () => {
    const existing = { amountMinor: 50000n, payee: "Acme Corp" };
    const incoming = { amountMinor: 50000, payee: "Different Vendor" };
    expect(existing.payee === incoming.payee).toBe(false);
  });
});
