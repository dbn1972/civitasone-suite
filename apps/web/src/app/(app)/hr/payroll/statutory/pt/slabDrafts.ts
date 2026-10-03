/**
 * GAP-PAYROLL-STATUTORY-PT-04: client-side parsing + checks of the slab rows
 * typed into the "new version" form. Mirrors payroll-service's
 * pt-versions-domain.ts (the authority, which re-checks everything): inclusive
 * paise ranges, no overlap or duplicate start inside one set, a single month's
 * tax never above the Article 276(2) annual cap. Money is parsed from rupee
 * text to paise with no float maths (lib/money).
 */
import { parseRupeesToPaise } from "@/lib/money";
import { PT_ANNUAL_CAP_MINOR, PT_NO_UPPER_BOUND_MINOR } from "./constants";
import type { PtApiSlab } from "./viewModel";

export type SlabDraft = { from: string; to: string; tax: string; feb: string };

export type SlabIssue = "from" | "to" | "range" | "tax" | "feb" | "cap" | "overlap" | "none";
export type SlabField = "from" | "to" | "tax" | "feb";
export type SlabCheck =
  | { ok: true; slabs: PtApiSlab[] }
  | { ok: false; issue: SlabIssue; row: number; field: SlabField };

const toNumber = (paise: string): number => Number(paise);

/** Existing slab -> editable draft (paise -> rupee text, "" = no upper bound / no February amount). */
export function draftFromSlab(s: PtApiSlab): SlabDraft {
  const rupees = (m: number) => (m % 100 === 0 ? String(m / 100) : (m / 100).toFixed(2));
  return {
    from: rupees(s.fromMinor),
    to: s.toMinor >= PT_NO_UPPER_BOUND_MINOR ? "" : rupees(s.toMinor),
    tax: rupees(s.taxMinor),
    feb: s.februaryTaxMinor == null ? "" : rupees(s.februaryTaxMinor),
  };
}

export const blankDraft = (): SlabDraft => ({ from: "", to: "", tax: "", feb: "" });

export function checkSlabDrafts(drafts: readonly SlabDraft[]): SlabCheck {
  if (!drafts.some(Boolean)) return { ok: false, issue: "none", row: 0, field: "from" };
  const slabs: PtApiSlab[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i]!;
    const from = parseRupeesToPaise(d.from, { allowZero: true });
    if (from === null) return { ok: false, issue: "from", row: i, field: "from" };
    const to = d.to.trim() === "" ? String(PT_NO_UPPER_BOUND_MINOR) : parseRupeesToPaise(d.to, { allowZero: true });
    if (to === null) return { ok: false, issue: "to", row: i, field: "to" };
    if (toNumber(to) < toNumber(from)) return { ok: false, issue: "range", row: i, field: "to" };
    const tax = parseRupeesToPaise(d.tax, { allowZero: true });
    if (tax === null) return { ok: false, issue: "tax", row: i, field: "tax" };
    if (toNumber(tax) > PT_ANNUAL_CAP_MINOR) return { ok: false, issue: "cap", row: i, field: "tax" };
    let feb: number | null = null;
    if (d.feb.trim() !== "") {
      const f = parseRupeesToPaise(d.feb, { allowZero: true });
      if (f === null) return { ok: false, issue: "feb", row: i, field: "feb" };
      if (toNumber(f) > PT_ANNUAL_CAP_MINOR) return { ok: false, issue: "cap", row: i, field: "feb" };
      feb = toNumber(f);
    }
    slabs.push({ fromMinor: toNumber(from), toMinor: toNumber(to), taxMinor: toNumber(tax), februaryTaxMinor: feb });
  }
  const order = slabs.map((s, row) => ({ s, row })).sort((a, b) => a.s.fromMinor - b.s.fromMinor);
  for (let i = 1; i < order.length; i++) {
    const prev = order[i - 1]!;
    const cur = order[i]!;
    if (cur.s.fromMinor <= prev.s.toMinor) return { ok: false, issue: "overlap", row: cur.row, field: "from" };
  }
  return { ok: true, slabs };
}

/** Gaps in the set (paise ranges no slab covers between the first start and the last end): shown as a warning, never blocked. */
export function slabGaps(slabs: readonly PtApiSlab[]): Array<{ fromMinor: number; toMinor: number }> {
  const sorted = [...slabs].sort((a, b) => a.fromMinor - b.fromMinor);
  const gaps: Array<{ fromMinor: number; toMinor: number }> = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;
    if (next.fromMinor > prev.toMinor + 1) gaps.push({ fromMinor: prev.toMinor + 1, toMinor: next.fromMinor - 1 });
  }
  return gaps;
}

/** The first of `from` (the form's earliest allowed effective date) that a chosen date violates, if any. */
export function effectiveDateIssue(date: string, earliest: string | null): "required" | "tooEarly" | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "required";
  if (earliest && date < earliest) return "tooEarly";
  return null;
}

export const isBackDated = (date: string, today: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today;
