/**
 * MSME M3a: GST input tax on a vendor bill -- capture schema, CA-flagged configuration, validation, and the pure journal builder.
 *
 * NOTHING HERE IS LAW. The RCM scope (s.9(3)/9(4)) and the s.17(5) blocked-credit list are notified lists that change; they are
 * CONFIGURATION, empty by default and owned by the named CA (docs: MSME-STATUTORY-CONFIG sections 4 and 5, both high-VERIFY):
 *   FINANCE_GST_RCM_CATEGORIES          comma list of RCM category keys this deployment accepts. EMPTY => every RCM bill is refused
 *                                       (conservative: nothing is treated as reverse-charge until the CA configures it).
 *   FINANCE_GST_ITC_BLOCKED_CATEGORIES  comma list of block-category keys whose ITC is blocked (s.17(5)). A line naming one is forced to
 *                                       'blocked' whatever it declared. EMPTY => only a line that itself declares ineligible/blocked is.
 * Read at call time (like every system-head env var), so a deployment/test override is honoured.
 *
 * Accounting (all amounts paise bigint; net = gross - deductions, as the bill already posts):
 *   normal bill (supplier charged the tax; it is INSIDE net):
 *     Dr expense head (net - eligible tax)   Dr per-tax ITC head (each eligible tax)   Cr AP (net)
 *     ineligible / blocked tax is not credit: it stays in the expense (it is a cost).
 *   RCM bill (supplier charged nothing; the recipient self-assesses, so net is the taxable value):
 *     Dr expense (net + non-eligible tax)   Dr ITC-RCM-pending (eligible tax)   Cr AP (net)   Cr RCM payable (all tax)
 *     ITC sits in the pending head until the tax is PAID (finance.gst.rcm_itc_claim moves it to the per-tax head).
 */
import { z } from "zod";
import { zMoneyMinor } from "@civitasone/schemas/money";
import { NonRetryableError } from "@civitasone/queue";
import { GST_ITC_HEAD_CODE, RCM_ITC_PENDING_CODE, RCM_PAYABLE_CODE, type GstTaxType } from "../gl/gst-heads.js";
import { isValidGstRate } from "./gst-rates.js";

export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export type ItcCategory = "eligible" | "ineligible" | "blocked";
export const ITC_CATEGORIES = ["eligible", "ineligible", "blocked"] as const;
export const GST_TAX_TYPES = ["IGST", "CGST", "SGST", "CESS"] as const;

const moneyNonNeg = zMoneyMinor.pipe(z.bigint().nonnegative());

/** The capture shape on POST /v1/finance/bills and on the finance.bill.create payload (money accepted as bigint | number | string). */
export const billGstInput = z.object({
  supplierGstin: z.string().regex(GSTIN_PATTERN, "supplier GSTIN is not a valid 15-character GSTIN").optional(),
  rcm: z.boolean().default(false),
  /** Required when rcm; must be one of the CA-configured RCM categories. */
  rcmCategory: z.string().trim().min(1).max(64).optional(),
  lines: z.array(z.object({
    gstType: z.enum(GST_TAX_TYPES),
    ratePct: z.number().min(0).max(100),
    taxableMinor: moneyNonNeg,
    taxMinor: moneyNonNeg,
    hsnCode: z.string().regex(/^[0-9]{2,8}$/, "HSN/SAC must be 2-8 digits").optional(),
    itcCategory: z.enum(ITC_CATEGORIES).default("eligible"),
    /** Optional s.17(5) category key; if the CA-configured blocked list names it, the line is forced to 'blocked'. */
    blockCategory: z.string().trim().min(1).max(64).optional(),
  })).min(1).max(20),
});
export type BillGstInput = z.infer<typeof billGstInput>;
export type GstInputLine = BillGstInput["lines"][number];

/** Money as decimal strings (the JSON/jsonb/queue-safe form). */
export type GstLineWire = Omit<GstInputLine, "taxableMinor" | "taxMinor"> & { taxableMinor: string; taxMinor: string };
export type BillGstWire = Omit<BillGstInput, "lines"> & { lines: GstLineWire[] };

export function gstToWire(g: BillGstInput): BillGstWire {
  return { ...g, lines: g.lines.map((l) => ({ ...l, taxableMinor: l.taxableMinor.toString(), taxMinor: l.taxMinor.toString() })) };
}

/** Throws a NonRetryableError(GST_INVALID_INPUT ...) for a malformed wire payload (also re-validates what the API accepted). */
export function parseBillGst(raw: unknown): BillGstInput {
  const r = billGstInput.safeParse(raw);
  if (!r.success) {
    throw new NonRetryableError(`GST_INVALID_INPUT: bill GST block is malformed (${r.error.issues.map((i) => i.path.join(".")).join(", ")})`);
  }
  return r.data;
}

// ---------------------------------------------------------------- CA-flagged configuration (empty by default)

const csv = (v: string | undefined): Set<string> => new Set((v ?? "").split(",").map((s) => s.trim()).filter(Boolean));
export const rcmCategories = (): Set<string> => csv(process.env.FINANCE_GST_RCM_CATEGORIES);
export const blockedItcCategories = (): Set<string> => csv(process.env.FINANCE_GST_ITC_BLOCKED_CATEGORIES);

/** A line's effective ITC category: the CA-configured blocked list wins over a declared 'eligible' (conservative). */
export function resolveItcCategory(line: Pick<GstInputLine, "itcCategory" | "blockCategory">, blocked: Set<string> = blockedItcCategories()): ItcCategory {
  if (line.blockCategory && blocked.has(line.blockCategory)) return "blocked";
  return line.itcCategory;
}

// ---------------------------------------------------------------- validation

/** tax = round-half-up(taxable * rate%). ratePct has at most 2 decimals; computed in basis points to stay in integers. */
export function expectedTaxMinor(taxableMinor: bigint, ratePct: number): bigint {
  const bp = BigInt(Math.round(ratePct * 100));
  return (taxableMinor * bp + 5000n) / 10000n;
}

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

/**
 * Pure structural + statutory-shape validation. `slabs` are the full-slab rates in force on the bill date (rate master).
 * Throws NonRetryableError with a stable GST_* code; returns the lines with their resolved ITC category.
 */
export function validateBillGst(g: BillGstInput, netMinor: bigint, slabs: readonly number[]): Array<GstInputLine & { itcCategory: ItcCategory }> {
  const fail = (code: string, msg: string): never => { throw new NonRetryableError(`${code}: ${msg}`); };
  const seen = new Set<string>();
  for (const l of g.lines) {
    const k = `${l.gstType}|${l.ratePct}`;
    if (seen.has(k)) fail("GST_DUPLICATE_LINE", `more than one ${l.gstType} @ ${l.ratePct}% line; combine them (the GST ledger keeps one row per tax type and rate per bill). Split the bill if the lines differ in ITC eligibility`);
    seen.add(k);
    if (!isValidGstRate(l.ratePct, l.gstType, slabs)) fail("GST_RATE_INVALID", `${l.ratePct}% is not a valid ${l.gstType} rate on the bill date`);
    if (l.gstType !== "CESS") {
      const want = expectedTaxMinor(l.taxableMinor, l.ratePct);
      if (abs(l.taxMinor - want) > 1n) fail("GST_TAX_MISMATCH", `${l.gstType} @ ${l.ratePct}% on ${l.taxableMinor} paise should be ${want} paise, got ${l.taxMinor}`);
    }
  }
  const has = (t: string): boolean => g.lines.some((l) => l.gstType === t);
  if (has("IGST") && (has("CGST") || has("SGST"))) fail("GST_MIXED_SUPPLY", "IGST cannot be combined with CGST/SGST on one bill (inter-state vs intra-state)");
  if (has("CGST") !== has("SGST")) fail("GST_UNPAIRED_CGST_SGST", "CGST and SGST are charged together on an intra-state supply");
  if (has("CGST")) {
    const c = g.lines.find((l) => l.gstType === "CGST")!; const s = g.lines.find((l) => l.gstType === "SGST")!;
    if (c.ratePct !== s.ratePct || c.taxMinor !== s.taxMinor) fail("GST_CGST_SGST_UNEQUAL", "CGST and SGST must carry the same rate and amount");
  }
  const totalTax = g.lines.reduce((s, l) => s + l.taxMinor, 0n);
  if (!g.rcm && totalTax > netMinor) fail("GST_TAX_EXCEEDS_BILL", `input tax ${totalTax} paise exceeds the bill value ${netMinor} paise`);
  if (g.rcm) {
    if (!g.rcmCategory) fail("GST_RCM_CATEGORY_REQUIRED", "a reverse-charge bill must name its RCM category");
    if (!rcmCategories().has(g.rcmCategory!)) fail("GST_RCM_CATEGORY_NOT_CONFIGURED", `RCM category '${g.rcmCategory}' is not configured (FINANCE_GST_RCM_CATEGORIES is CA-owned and empty by default)`);
  }
  const blocked = blockedItcCategories();
  return g.lines.map((l) => ({ ...l, itcCategory: resolveItcCategory(l, blocked) }));
}

// ---------------------------------------------------------------- journal builder

export type JournalLineOut = { accountCode: string; debitMinor: bigint; creditMinor: bigint; narration?: string };

/** One GST-ledger entry per input tax line, as it will be sent on finance.gst.entry_record. */
export type GstLedgerEntry = {
  gstType: GstTaxType; ratePct: number; taxableMinor: string; taxMinor: string; hsnCode?: string;
  itcCategory: ItcCategory; rcm: boolean;
  /** The head that carries this tax in the GL; null when the tax was costed into the expense. */
  glHeadCode: string | null;
};

/**
 * Pure. `expenseAccount` is whatever the existing bill posting uses for the expense leg (a head uuid or code). Returns the FULL journal
 * line set (expense, ITC / RCM legs, AP) -- the caller replaces its two-line bill journal with it -- and the ledger entries.
 */
export function buildBillGstPosting(args: {
  expenseAccount: string; apAccount: string; netMinor: bigint; rcm: boolean;
  lines: Array<GstInputLine & { itcCategory: ItcCategory }>;
}): { lines: JournalLineOut[]; entries: GstLedgerEntry[] } {
  const { expenseAccount, apAccount, netMinor, rcm } = args;
  const eligByType = new Map<GstTaxType, bigint>();
  let eligible = 0n; let all = 0n;
  const entries: GstLedgerEntry[] = args.lines.map((l) => {
    all += l.taxMinor;
    const isElig = l.itcCategory === "eligible" && l.taxMinor > 0n;
    if (isElig) { eligible += l.taxMinor; eligByType.set(l.gstType, (eligByType.get(l.gstType) ?? 0n) + l.taxMinor); }
    return {
      gstType: l.gstType, ratePct: l.ratePct, taxableMinor: l.taxableMinor.toString(), taxMinor: l.taxMinor.toString(),
      ...(l.hsnCode ? { hsnCode: l.hsnCode } : {}), itcCategory: l.itcCategory, rcm,
      glHeadCode: isElig ? (rcm ? RCM_ITC_PENDING_CODE : GST_ITC_HEAD_CODE[l.gstType]) : null,
    };
  });
  const out: JournalLineOut[] = [];
  const expense = rcm ? netMinor + (all - eligible) : netMinor - eligible;
  out.push({ accountCode: expenseAccount, debitMinor: expense, creditMinor: 0n });
  if (rcm) {
    if (eligible > 0n) out.push({ accountCode: RCM_ITC_PENDING_CODE, debitMinor: eligible, creditMinor: 0n, narration: "RCM input tax credit (awaiting payment of RCM tax)" });
    out.push({ accountCode: apAccount, debitMinor: 0n, creditMinor: netMinor });
    if (all > 0n) out.push({ accountCode: RCM_PAYABLE_CODE, debitMinor: 0n, creditMinor: all, narration: "GST payable under reverse charge" });
  } else {
    for (const t of GST_TAX_TYPES) {
      const v = eligByType.get(t);
      if (v && v > 0n) out.push({ accountCode: GST_ITC_HEAD_CODE[t], debitMinor: v, creditMinor: 0n, narration: `Input tax credit ${t}` });
    }
    out.push({ accountCode: apAccount, debitMinor: 0n, creditMinor: netMinor });
  }
  return { lines: out, entries };
}

/** The journal-payload metadata the GL consumer hook turns into finance.gst.entry_record messages (in the posting tx). */
export type GstJournalMeta = {
  sourceDocType: string; sourceDocId: string; invoiceNo: string; invoiceDate: string;
  partyGstin?: string | null; partyName?: string | null;
  entries?: GstLedgerEntry[];
  /** RCM ITC claim: the bill whose pending ITC this journal moves to the per-tax heads. */
  rcmClaimOf?: string;
};
