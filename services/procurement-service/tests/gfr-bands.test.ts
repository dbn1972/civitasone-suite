/**
 * GFR 2017 procurement-mode value-band enforcement — boundary tests.
 *
 * Money is PAISE (bigint). Boundaries are INCLUSIVE of the upper rupee figure.
 * These tests pin the EXACT paise edges so a future refactor cannot silently
 * shift a band ceiling (e.g. permit direct purchase for a Rs 25,001 indent).
 *
 * Ceilings under test:
 *   - direct_purchase  <= Rs    25,000 ( 2_500_000 paise) — GFR R.154
 *   - limited_tender   <= Rs 50,00,000 (500_000_000 paise) — GFR R.162
 *   - advertised_tender > Rs 50,00,000                      — GFR R.161
 *   - gem / single_tender: permissible at ANY value (their own controls).
 */
import { describe, it, expect } from "vitest";
import {
  assertModeAllowedForValue,
  allowedModesForValue,
  modeForTenderType,
  bandLabel,
  GfrModeError,
  DIRECT_PURCHASE_CEILING_MINOR,
  LIMITED_TENDER_CEILING_MINOR,
  type ProcurementMode,
} from "../src/modules/gfr/mode-bands.js";

function rejects(mode: ProcurementMode, valueMinor: bigint): string | null {
  try {
    assertModeAllowedForValue(mode, valueMinor);
    return null;
  } catch (err) {
    if (err instanceof GfrModeError) return err.code;
    throw err;
  }
}

describe("GFR mode-bands — direct_purchase ceiling (Rs 25,000)", () => {
  it("ACCEPTS direct_purchase exactly AT the ceiling (inclusive boundary)", () => {
    expect(rejects("direct_purchase", DIRECT_PURCHASE_CEILING_MINOR)).toBeNull();
  });

  it("ACCEPTS direct_purchase one paise BELOW the ceiling", () => {
    expect(rejects("direct_purchase", DIRECT_PURCHASE_CEILING_MINOR - 1n)).toBeNull();
  });

  it("REJECTS direct_purchase one paise ABOVE the ceiling (Rs 25,000.01)", () => {
    expect(rejects("direct_purchase", DIRECT_PURCHASE_CEILING_MINOR + 1n)).toBe("GFR_MODE_NOT_ALLOWED");
  });

  it("ACCEPTS direct_purchase at zero value", () => {
    expect(rejects("direct_purchase", 0n)).toBeNull();
  });
});

describe("GFR mode-bands — limited_tender ceiling (Rs 50,00,000)", () => {
  it("ACCEPTS limited_tender exactly AT the ceiling (inclusive boundary)", () => {
    expect(rejects("limited_tender", LIMITED_TENDER_CEILING_MINOR)).toBeNull();
  });

  it("ACCEPTS limited_tender just inside the committee band (Rs 25,001)", () => {
    expect(rejects("limited_tender", DIRECT_PURCHASE_CEILING_MINOR + 1n)).toBeNull();
  });

  it("REJECTS limited_tender one paise ABOVE the ceiling (must advertise)", () => {
    expect(rejects("limited_tender", LIMITED_TENDER_CEILING_MINOR + 1n)).toBe("GFR_MODE_NOT_ALLOWED");
  });

  it("REJECTS direct_purchase inside the limited band (under-procuring a Rs 10,00,000 value)", () => {
    expect(rejects("direct_purchase", 100_000_000n)).toBe("GFR_MODE_NOT_ALLOWED");
  });
});

describe("GFR mode-bands — advertised_tender floor (> Rs 50,00,000)", () => {
  it("ACCEPTS advertised_tender just above the ceiling", () => {
    expect(rejects("advertised_tender", LIMITED_TENDER_CEILING_MINOR + 1n)).toBeNull();
  });

  it("ACCEPTS advertised_tender (higher rigour) for a tiny value — over-procuring is never a violation", () => {
    expect(rejects("advertised_tender", 1n)).toBeNull();
  });

  it("REJECTS limited_tender for a value above the advertised floor", () => {
    expect(rejects("limited_tender", 1_000_000_000n)).toBe("GFR_MODE_NOT_ALLOWED");
  });
});

describe("GFR mode-bands — exception modes (gem, single_tender) at any value", () => {
  it("ACCEPTS gem at a tiny value", () => {
    expect(rejects("gem", 1n)).toBeNull();
  });
  it("ACCEPTS gem at a huge value (Rs 10 crore)", () => {
    expect(rejects("gem", 1_000_000_000_00n)).toBeNull();
  });
  it("ACCEPTS single_tender above the advertised floor (justification-gated, not band-gated)", () => {
    expect(rejects("single_tender", LIMITED_TENDER_CEILING_MINOR + 1n)).toBeNull();
  });
});

describe("GFR mode-bands — invalid inputs", () => {
  it("REJECTS a negative estimated value", () => {
    expect(rejects("limited_tender", -1n)).toBe("GFR_INVALID_VALUE");
  });
});

describe("GFR mode-bands — allowedModesForValue includes the band mode + exceptions", () => {
  it("small value → direct_purchase + gem + single_tender", () => {
    const modes = allowedModesForValue(DIRECT_PURCHASE_CEILING_MINOR);
    expect(modes[0]).toBe("direct_purchase");
    expect(modes).toContain("gem");
    expect(modes).toContain("single_tender");
  });

  it("mid value → limited_tender leads", () => {
    expect(allowedModesForValue(LIMITED_TENDER_CEILING_MINOR)[0]).toBe("limited_tender");
  });

  it("high value → advertised_tender leads", () => {
    expect(allowedModesForValue(LIMITED_TENDER_CEILING_MINOR + 1n)[0]).toBe("advertised_tender");
  });
});

describe("GFR mode-bands — modeForTenderType mapping", () => {
  it("maps tender type enum onto canonical procurement modes", () => {
    expect(modeForTenderType("open")).toBe("advertised_tender");
    expect(modeForTenderType("limited")).toBe("limited_tender");
    expect(modeForTenderType("single_source")).toBe("single_tender");
    expect(modeForTenderType("gem")).toBe("gem");
    expect(modeForTenderType("unknown")).toBe("advertised_tender"); // safe default = highest rigour
  });

  it("an 'open' tender below the band floor is accepted (advertised = highest rigour)", () => {
    expect(rejects(modeForTenderType("open"), 1n)).toBeNull();
  });

  it("a 'limited' tender above the advertised floor is REJECTED at create time", () => {
    expect(rejects(modeForTenderType("limited"), LIMITED_TENDER_CEILING_MINOR + 1n)).toBe("GFR_MODE_NOT_ALLOWED");
  });
});

describe("GFR mode-bands — bandLabel human strings (for error surfaces)", () => {
  it("labels each band distinctly", () => {
    expect(bandLabel(0n)).toMatch(/direct purchase/i);
    expect(bandLabel(DIRECT_PURCHASE_CEILING_MINOR + 1n)).toMatch(/committee|GeM/i);
    expect(bandLabel(LIMITED_TENDER_CEILING_MINOR)).toMatch(/limited tender/i);
    expect(bandLabel(LIMITED_TENDER_CEILING_MINOR + 1n)).toMatch(/advertised/i);
  });
});
