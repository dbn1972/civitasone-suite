/**
 * TDS section -> statutory rate reference (DOM-013).
 *
 * Pre-fix, `routes.ts` accepted ANY of [0,1,1.5,2,5,7.5,10,20,30] for
 * `tdsRatePct` regardless of `section` (a free-text field, max 10 chars,
 * defaulting to "194C" with no validation at all). Two of those flat values
 * -- 1.5 and 7.5 -- are not current statutory rates for any section below:
 * they are the 25%-reduced COVID-19 relief rates that applied ONLY between
 * 2020-05-14 and 2021-03-31 (CBDT press release, 13-May-2020) and lapsed on
 * 2021-04-01. A caller could previously pick e.g. section "194J" with rate
 * 7.5% for a deduction dated today, five years after that concession ended.
 *
 * This table pins each section to its valid rate(s), each with an
 * effective-date window, so a rate can only be selected for a section on a
 * deduction date where that (section, rate) pair was actually in force.
 *
 * CAUTION (read before relying on this for a real TDS deposit / Form 26Q
 * filing): the *current* (non-COVID) slabs reflect the sections most
 * commonly used in government vendor-payment contexts, to the best of
 * available knowledge as of this fix (Sep 2026). TDS rates are amended most
 * fiscal years by the Finance Act / CBDT circulars (e.g. several
 * commission/rent-adjacent sections were cut from 5%->2% effective
 * 2024-10-01). This table has NOT been independently verified against the
 * current Finance Act by a qualified tax professional -- it closes the
 * specific DOM-013 gap (stale COVID rate selectable, free-text section) but
 * does NOT certify every current rate below is still correct at the moment
 * you read this. Re-verify against the live Finance Act / CBDT
 * notifications before relying on it for an actual statutory filing.
 */

export interface TdsRateSlab {
  /** Percentage, e.g. 2 for 2%. */
  ratePct: number;
  /** Inclusive start date, YYYY-MM-DD. */
  effectiveFrom: string;
  /** Inclusive end date, YYYY-MM-DD. Omitted = still in force. */
  effectiveTo?: string;
  note?: string;
}

export interface TdsSectionDef {
  section: string;
  label: string;
  slabs: TdsRateSlab[];
}

const COVID_FROM = "2020-05-14";
const COVID_TO = "2021-03-31";
const COVID_NOTE = "COVID-19 relief rate (Section 194C(6)... economic package); lapsed 2021-03-31 — not valid for current-date deductions";

export const TDS_SECTIONS: readonly TdsSectionDef[] = [
  {
    section: "194C",
    label: "Payments to contractors",
    slabs: [
      { ratePct: 1, effectiveFrom: "2010-07-01" },
      { ratePct: 2, effectiveFrom: "2010-07-01" },
      { ratePct: 1.5, effectiveFrom: COVID_FROM, effectiveTo: COVID_TO, note: COVID_NOTE },
    ],
  },
  {
    section: "194H",
    label: "Commission or brokerage",
    slabs: [
      { ratePct: 5, effectiveFrom: "2010-07-01" },
    ],
  },
  {
    section: "194I",
    label: "Rent (plant/machinery: 2%; land/building/furniture: 10%)",
    slabs: [
      { ratePct: 2, effectiveFrom: "2010-07-01" },
      { ratePct: 10, effectiveFrom: "2010-07-01" },
      { ratePct: 1.5, effectiveFrom: COVID_FROM, effectiveTo: COVID_TO, note: COVID_NOTE },
      { ratePct: 7.5, effectiveFrom: COVID_FROM, effectiveTo: COVID_TO, note: COVID_NOTE },
    ],
  },
  {
    section: "194J",
    label: "Professional fees (10%) / fees for technical services (2%)",
    slabs: [
      { ratePct: 2, effectiveFrom: "2010-07-01" },
      { ratePct: 10, effectiveFrom: "2010-07-01" },
      { ratePct: 1.5, effectiveFrom: COVID_FROM, effectiveTo: COVID_TO, note: COVID_NOTE },
      { ratePct: 7.5, effectiveFrom: COVID_FROM, effectiveTo: COVID_TO, note: COVID_NOTE },
    ],
  },
  {
    section: "194A",
    label: "Interest other than on securities",
    slabs: [
      { ratePct: 10, effectiveFrom: "2010-07-01" },
      { ratePct: 7.5, effectiveFrom: COVID_FROM, effectiveTo: COVID_TO, note: COVID_NOTE },
    ],
  },
  {
    section: "194B",
    label: "Winnings from lottery/game show (flat rate; excluded from the COVID-19 relief cut)",
    slabs: [
      { ratePct: 30, effectiveFrom: "2010-07-01" },
    ],
  },
  {
    section: "206AA",
    label: "No-PAN override — flat rate applied in place of the normal section rate when deductee PAN is unavailable",
    slabs: [
      { ratePct: 20, effectiveFrom: "2010-04-01" },
    ],
  },
  {
    section: "197",
    label: "Nil / lower-deduction certificate",
    slabs: [
      { ratePct: 0, effectiveFrom: "2000-01-01" },
    ],
  },
] as const;

export const TDS_SECTION_CODES = TDS_SECTIONS.map((s) => s.section) as [string, ...string[]];

/**
 * True if `ratePct` was a valid statutory rate for `section` on `onDate`
 * (YYYY-MM-DD). Returns false for an unknown section, an unlisted rate, or
 * a listed-but-expired (e.g. COVID-era) rate on the given date.
 */
export function isValidTdsRateForSection(section: string, ratePct: number, onDate: string): boolean {
  const def = TDS_SECTIONS.find((s) => s.section === section);
  if (!def) return false;
  return def.slabs.some((slab) => {
    if (slab.ratePct !== ratePct) return false;
    if (onDate < slab.effectiveFrom) return false;
    if (slab.effectiveTo && onDate > slab.effectiveTo) return false;
    return true;
  });
}
