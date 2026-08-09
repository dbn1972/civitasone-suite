/**
 * FN-15 — Renewal lifecycle.
 * BRD acceptance: "Trade License renewal prefills and blocks outside window."
 */
import { describe, it, expect } from "vitest";
import {
  canRenew,
  computeValidTo,
  renewalEligibility,
  renewalPrefill,
  type RenewalPolicy,
} from "./renewal.js";

/** Trade License: annual licence, renewal opens 30 days before expiry. */
const TL: RenewalPolicy = {
  renewable: true,
  renewalWindowDays: 30,
  validityMode: "duration",
  validityYears: 1,
};

const ISSUED = new Date("2026-01-15T00:00:00Z");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("FN-15 computeValidTo", () => {
  it("adds the validity duration in calendar years", () => {
    expect(computeValidTo(TL, ISSUED)).toBe("2027-01-15");
    expect(computeValidTo({ ...TL, validityYears: 5 }, ISSUED)).toBe("2031-01-15");
  });

  it("keeps calendar semantics across a leap day", () => {
    // A clerk renewing a 29 Feb licence writes 1 Mar, not 28 Feb.
    expect(computeValidTo(TL, d("2028-02-29"))).toBe("2029-03-01");
  });

  it("uses the fixed date when the pack sets one", () => {
    expect(
      computeValidTo({ ...TL, validityMode: "fixed_date", validityFixedDate: "2027-03-31" }, ISSUED),
    ).toBe("2027-03-31");
  });

  it("returns null when the output never expires", () => {
    expect(computeValidTo({ ...TL, validityMode: "none" }, ISSUED)).toBeNull();
  });

  it("returns null for an unusable validity config rather than guessing", () => {
    expect(computeValidTo({ ...TL, validityYears: 0 }, ISSUED)).toBeNull();
    expect(computeValidTo({ ...TL, validityYears: undefined }, ISSUED)).toBeNull();
    expect(computeValidTo({ ...TL, validityMode: "fixed_date", validityFixedDate: "not-a-date" }, ISSUED)).toBeNull();
    expect(computeValidTo({ ...TL, validityMode: "fixed_date", validityFixedDate: undefined }, ISSUED)).toBeNull();
  });
});

describe("FN-15 renewalEligibility — BRD: blocks outside the window", () => {
  it("blocks before the window opens, and says when it opens", () => {
    const r = renewalEligibility(TL, ISSUED, d("2026-11-01"));
    expect(r.state).toBe("too_early");
    expect(r.opensAt).toBe("2026-12-16"); // 30 days before 2027-01-15
    expect(r.validTo).toBe("2027-01-15");
    expect(r.reason).toContain("2026-12-16");
  });

  it("opens exactly on the first day of the window", () => {
    expect(renewalEligibility(TL, ISSUED, d("2026-12-16")).state).toBe("open");
    // ...and is still closed the day before.
    expect(renewalEligibility(TL, ISSUED, d("2026-12-15")).state).toBe("too_early");
  });

  it("stays open on the expiry date itself", () => {
    expect(renewalEligibility(TL, ISSUED, d("2027-01-15")).state).toBe("open");
  });

  it("blocks the day after expiry and directs the citizen to apply afresh", () => {
    const r = renewalEligibility(TL, ISSUED, d("2027-01-16"));
    expect(r.state).toBe("expired");
    expect(r.reason).toMatch(/new application/i);
  });

  it("treats a zero window as 'opens on the expiry date'", () => {
    const p = { ...TL, renewalWindowDays: 0 };
    expect(renewalEligibility(p, ISSUED, d("2027-01-14")).state).toBe("too_early");
    expect(renewalEligibility(p, ISSUED, d("2027-01-15")).state).toBe("open");
  });

  it("reports not_renewable when the pack does not offer renewal", () => {
    const r = renewalEligibility({ ...TL, renewable: false }, ISSUED, d("2027-01-01"));
    expect(r.state).toBe("not_renewable");
  });

  it("reports not_renewable when the output never expires", () => {
    const r = renewalEligibility({ ...TL, validityMode: "none" }, ISSUED, d("2027-01-01"));
    expect(r.state).toBe("not_renewable");
    expect(r.reason).toMatch(/no expiry/i);
  });

  it("ignores time of day — the window is date-based", () => {
    const early = renewalEligibility(TL, ISSUED, new Date("2026-12-16T23:59:59Z"));
    const late = renewalEligibility(TL, ISSUED, new Date("2026-12-16T00:00:01Z"));
    expect(early.state).toBe("open");
    expect(late.state).toBe("open");
  });

  it("treats a negative window as zero rather than opening renewal early", () => {
    const p = { ...TL, renewalWindowDays: -30 };
    expect(renewalEligibility(p, ISSUED, d("2027-01-14")).state).toBe("too_early");
  });

  it("canRenew agrees with the full eligibility state", () => {
    expect(canRenew(TL, ISSUED, d("2026-12-20"))).toBe(true);
    expect(canRenew(TL, ISSUED, d("2026-01-20"))).toBe(false);
  });
});

describe("FN-15 renewalPrefill — BRD: lighter form prefilled", () => {
  const parent = {
    tradeName: "Kumar Provisions",
    tradeCategory: "Retail",
    ownerName: "A Kumar",
    ward: "W12",
    applicationDate: "2026-01-15",
    idProof: "file-1",
    addressProof: "file-2",
    emptyField: null,
  };

  it("carries over what is being licensed", () => {
    const out = renewalPrefill(parent, { documentApiNames: ["idProof", "addressProof"] });
    expect(out.tradeName).toBe("Kumar Provisions");
    expect(out.tradeCategory).toBe("Retail");
    expect(out.ownerName).toBe("A Kumar");
    expect(out.ward).toBe("W12");
  });

  it("drops dates so a renewal cannot reassert last year's declaration", () => {
    const out = renewalPrefill(parent);
    expect(out).not.toHaveProperty("applicationDate");
  });

  it("drops uploaded evidence — documents must be re-supplied", () => {
    const out = renewalPrefill(parent, { documentApiNames: ["idProof", "addressProof"] });
    expect(out).not.toHaveProperty("idProof");
    expect(out).not.toHaveProperty("addressProof");
  });

  it("honours explicit exclusions", () => {
    const out = renewalPrefill(parent, { excludeApiNames: ["tradeCategory"] });
    expect(out).not.toHaveProperty("tradeCategory");
    expect(out.tradeName).toBe("Kumar Provisions");
  });

  it("omits empty answers rather than prefilling nulls", () => {
    const out = renewalPrefill(parent);
    expect(out).not.toHaveProperty("emptyField");
  });

  it("handles a missing parent payload", () => {
    expect(renewalPrefill(undefined as unknown as Record<string, unknown>)).toEqual({});
  });
});
