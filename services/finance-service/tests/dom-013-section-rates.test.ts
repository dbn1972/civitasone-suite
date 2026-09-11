/**
 * DOM-013 — TDS section/rate controlled reference + effective-dating.
 *
 * Pre-fix: `tdsRatePct` was checked against a flat list
 * ([0,1,1.5,2,5,7.5,10,20,30]) with no link to `section` or the deduction
 * date, so a caller could pick a lapsed COVID-19-era concessional rate
 * (1.5% / 7.5%) for a current-date deduction; `section` was free text
 * (`z.string().max(10)`) accepting any junk value. Also covers the GST
 * `ratePct` validation added to the (currently producer-less) GST ledger
 * consumer as defense-in-depth for the same DoD line item.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  TDS_SECTION_CODES,
  isValidTdsRateForSection,
} from "../src/modules/tds/section-rates.js";
import { isValidGstRate, VALID_GST_RATES } from "../src/modules/gst/gst-rates.js";

describe("DOM-013 — TDS section is a controlled reference, not free text", () => {
  it("known statutory sections are accepted", () => {
    for (const section of TDS_SECTION_CODES) {
      expect(() => z.enum(TDS_SECTION_CODES).parse(section)).not.toThrow();
    }
  });

  it("rejects a free-text / junk section value that the old z.string().max(10) accepted", () => {
    expect(() => z.enum(TDS_SECTION_CODES).parse("NOT_A_SECTION")).toThrow();
    expect(() => z.enum(TDS_SECTION_CODES).parse("999Z")).toThrow();
  });
});

describe("DOM-013 — stale COVID-era rate no longer selectable for a current-date deduction", () => {
  it("194J at 7.5% (COVID relief rate) is rejected for a current-date deduction", () => {
    expect(isValidTdsRateForSection("194J", 7.5, "2026-09-11")).toBe(false);
  });

  it("194C at 1.5% (COVID relief rate) is rejected for a current-date deduction", () => {
    expect(isValidTdsRateForSection("194C", 1.5, "2026-09-11")).toBe(false);
  });

  it("194I at 7.5% is rejected for a current-date deduction", () => {
    expect(isValidTdsRateForSection("194I", 7.5, "2026-09-11")).toBe(false);
  });

  it("194A at 7.5% is rejected for a current-date deduction", () => {
    expect(isValidTdsRateForSection("194A", 7.5, "2026-09-11")).toBe(false);
  });

  it("the same rate WAS valid inside the actual COVID relief window (historical record)", () => {
    expect(isValidTdsRateForSection("194J", 7.5, "2020-08-01")).toBe(true);
    expect(isValidTdsRateForSection("194C", 1.5, "2020-08-01")).toBe(true);
  });

  it("is rejected even one day after the relief window closed", () => {
    expect(isValidTdsRateForSection("194J", 7.5, "2021-04-01")).toBe(false);
  });

  it("is still valid on the last day of the relief window", () => {
    expect(isValidTdsRateForSection("194J", 7.5, "2021-03-31")).toBe(true);
  });
});

describe("DOM-013 — current statutory rates remain valid for their section", () => {
  it("194C accepts 1% and 2% for a current-date deduction", () => {
    expect(isValidTdsRateForSection("194C", 1, "2026-09-11")).toBe(true);
    expect(isValidTdsRateForSection("194C", 2, "2026-09-11")).toBe(true);
  });
  it("194J accepts 2% and 10% for a current-date deduction", () => {
    expect(isValidTdsRateForSection("194J", 2, "2026-09-11")).toBe(true);
    expect(isValidTdsRateForSection("194J", 10, "2026-09-11")).toBe(true);
  });
  it("194H accepts 5%", () => {
    expect(isValidTdsRateForSection("194H", 5, "2026-09-11")).toBe(true);
  });
  it("194A accepts 10%", () => {
    expect(isValidTdsRateForSection("194A", 10, "2026-09-11")).toBe(true);
  });
  it("206AA no-PAN override accepts 20%", () => {
    expect(isValidTdsRateForSection("206AA", 20, "2026-09-11")).toBe(true);
  });
  it("197 nil-deduction certificate accepts 0%", () => {
    expect(isValidTdsRateForSection("197", 0, "2026-09-11")).toBe(true);
  });
});

describe("DOM-013 — wrong rate for section is rejected (DoD)", () => {
  it("30% (194B lottery rate) is rejected for 194C (contractor)", () => {
    expect(isValidTdsRateForSection("194C", 30, "2026-09-11")).toBe(false);
  });
  it("5% (194H commission rate) is rejected for 194A (interest)", () => {
    expect(isValidTdsRateForSection("194A", 5, "2026-09-11")).toBe(false);
  });
  it("an unknown section is always rejected regardless of rate", () => {
    expect(isValidTdsRateForSection("999Z", 10, "2026-09-11")).toBe(false);
  });
});

describe("DOM-013 — GST rate validated against standard slabs", () => {
  it("IGST accepts every full standard slab", () => {
    for (const r of VALID_GST_RATES) expect(isValidGstRate(r, "IGST")).toBe(true);
  });
  it("IGST rejects a non-slab / typo rate", () => {
    expect(isValidGstRate(8, "IGST")).toBe(false);
    expect(isValidGstRate(-5, "IGST")).toBe(false);
    expect(isValidGstRate(19, "IGST")).toBe(false);
  });
  it("CGST/SGST accept the HALVED slab (intra-state split of an 18% item is two 9% rows)", () => {
    expect(isValidGstRate(9, "CGST")).toBe(true);
    expect(isValidGstRate(9, "SGST")).toBe(true);
    expect(isValidGstRate(6, "CGST")).toBe(true); // half of 12%
    expect(isValidGstRate(14, "SGST")).toBe(true); // half of 28%
  });
  it("CGST/SGST reject a full-slab value (that would be double the real component rate)", () => {
    expect(isValidGstRate(18, "CGST")).toBe(false);
  });
  it("rejects negative or non-finite rates regardless of gstType", () => {
    expect(isValidGstRate(-1, "IGST")).toBe(false);
    expect(isValidGstRate(NaN, "CESS")).toBe(false);
    expect(isValidGstRate(150, "CGST")).toBe(false);
  });
  it("CESS only gets the sanity bound, not a fixed slab list (item-specific rates)", () => {
    expect(isValidGstRate(1, "CESS")).toBe(true);
    expect(isValidGstRate(22, "CESS")).toBe(true);
  });
});
