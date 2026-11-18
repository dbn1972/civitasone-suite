/**
 * MSME commercial M4: PURE (no I/O) GSTR-1 / GSTR-3B model builders. Input = the tenant's issued sales invoices + notes + advance
 * receipts (ar.*) and gl.finance_gst_ledger rows (input AND output). Output = a version-neutral model (bigint paise); adapters.ts
 * turns it into the pinned JSON wire shape. Deterministic, LLM-free, no live GSTN call (v1 is prepare / export only).
 */
import { EXPORT_POS, type GstrConfig } from "./config.js";

export interface LineIn { hsnSac: string | null; description: string; qty: string; uom: string | null; taxableMinor: bigint; gstRatePct: string; taxMinor: bigint }
export interface InvoiceIn {
  id: string; invoiceNo: string; invoiceDate: string; customerGstin: string | null; placeOfSupply: string; supplyType: "intra" | "inter" | "none";
  reverseCharge: boolean; taxableMinor: bigint; cgstMinor: bigint; sgstMinor: bigint; igstMinor: bigint; cessMinor: bigint; totalMinor: bigint; lines: LineIn[];
}
export interface NoteIn {
  id: string; noteNo: string; noteType: "credit" | "debit"; noteDate: string; invoiceId: string; invoiceNo: string; invoiceDate: string;
  customerGstin: string | null; placeOfSupply: string; supplyType: "intra" | "inter" | "none"; invoiceTotalMinor: bigint;
  /** s.34: false = a credit note issued past the deadline; its output-tax reduction is NOT claimable (cutoff stored by M2; CA-VERIFY). */
  withinS34Window: boolean;
  taxableMinor: bigint; cgstMinor: bigint; sgstMinor: bigint; igstMinor: bigint; cessMinor: bigint; totalMinor: bigint;
}
export interface AdvanceIn {
  id: string; receiptDate: string; placeOfSupply: string; supplyType: "intra" | "inter" | "none"; ratePct: string;
  taxableMinor: bigint; cgstMinor: bigint; sgstMinor: bigint; igstMinor: bigint; adjustedInvoiceDate: string | null;
}
export interface LedgerRow {
  direction: "input" | "output"; gstType: "CGST" | "SGST" | "IGST" | "CESS"; taxableMinor: bigint; taxMinor: bigint; invoiceDate: string;
  sourceDocType: string | null; sourceDocId: string | null; rcm: boolean; itcCategory: string | null; rcmItcClaimedOn: string | null;
}
export interface HsnMeta { code: string; description: string }

export interface Heads { igst: bigint; cgst: bigint; sgst: bigint; cess: bigint }
export const zeroHeads = (): Heads => ({ igst: 0n, cgst: 0n, sgst: 0n, cess: 0n });
const addHeads = (a: Heads, b: Heads, sign = 1n): Heads => ({ igst: a.igst + sign * b.igst, cgst: a.cgst + sign * b.cgst, sgst: a.sgst + sign * b.sgst, cess: a.cess + sign * b.cess });
export const headsTotal = (h: Heads): bigint => h.igst + h.cgst + h.sgst + h.cess;

const normRate = (r: string | number): string => String(Number(r));
export const rateIsZero = (r: string | number): boolean => Number(r) === 0;
export const supplierState = (gstin: string): string => gstin.slice(0, 2);

export interface Bucket extends Heads { rate: string; taxable: bigint }

/** Per-rate buckets of an invoice. Intra-state tax is halved per bucket, the rounding remainder is pushed so the buckets sum to the stored invoice heads. */
export function bucketsOf(inv: InvoiceIn, includeZeroRate: boolean): Bucket[] {
  const m = new Map<string, { taxable: bigint; tax: bigint }>();
  for (const l of inv.lines) {
    const r = normRate(l.gstRatePct);
    if (!includeZeroRate && Number(r) === 0) continue;
    const e = m.get(r) ?? { taxable: 0n, tax: 0n };
    e.taxable += l.taxableMinor; e.tax += l.taxMinor; m.set(r, e);
  }
  const out: Bucket[] = [...m.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([rate, e]) => {
    if (inv.supplyType === "inter") return { rate, taxable: e.taxable, igst: e.tax, cgst: 0n, sgst: 0n, cess: 0n };
    const c = e.tax / 2n;
    return { rate, taxable: e.taxable, igst: 0n, cgst: c, sgst: e.tax - c, cess: 0n };
  });
  const last = out[out.length - 1];
  if (last) {
    if (inv.supplyType === "intra") {
      last.cgst += inv.cgstMinor - out.reduce((a, b) => a + b.cgst, 0n);
      last.sgst += inv.sgstMinor - out.reduce((a, b) => a + b.sgst, 0n);
    } else if (inv.supplyType === "inter") {
      last.igst += inv.igstMinor - out.reduce((a, b) => a + b.igst, 0n);
    }
    out[0]!.cess += inv.cessMinor;
  }
  return out;
}

export type InvoiceClass = "b2b" | "b2cl" | "b2cs" | "exp";
export function classifyInvoice(i: Pick<InvoiceIn, "customerGstin" | "placeOfSupply" | "supplyType" | "totalMinor">, cfg: GstrConfig): InvoiceClass {
  if (i.placeOfSupply === EXPORT_POS) return "exp";
  if (i.customerGstin) return "b2b";
  if (i.supplyType === "inter" && i.totalMinor > cfg.b2clThresholdMinor) return "b2cl";
  return "b2cs";
}

/** Rate (percent, 2dp) implied by a note's tax / taxable. */
export function noteRate(n: Pick<NoteIn, "taxableMinor" | "cgstMinor" | "sgstMinor" | "igstMinor" | "cessMinor">): string {
  if (n.taxableMinor === 0n) return "0";
  const gst = n.cgstMinor + n.sgstMinor + n.igstMinor;
  const hundredths = (gst * 10000n * 2n + n.taxableMinor) / (n.taxableMinor * 2n);   // round half up
  return normRate(Number(hundredths) / 100);
}

// ---- GSTR-1 model ---------------------------------------------------------------------------------------------------------------------

export interface DocOut { num: string; date: string; val: bigint; pos: string; rchrg: boolean; items: Bucket[]; ctin?: string }
export interface NoteOut { type: "C" | "D"; num: string; date: string; val: bigint; pos: string; rchrg: boolean; items: Bucket[]; ctin?: string; origNum: string; origDate: string; exportKind?: "EXPWP" | "EXPWOP" }
export interface B2csRow extends Heads { splyTy: "INTER" | "INTRA"; rate: string; pos: string; taxable: bigint }
export interface NilRow { splyTy: "INTRB2B" | "INTRB2C" | "INTRAB2B" | "INTRAB2C"; nilAmt: bigint }
export interface HsnRow extends Heads { hsn: string; desc: string; uqc: string; qty: string; val: bigint; taxable: bigint; rate: string }
export interface DocIssueRow { nature: string; from: string; to: string; total: number; cancelled: number; net: number }
export interface AdvRow extends Heads { splyTy: "INTER" | "INTRA"; pos: string; rate: string; adAmt: bigint }
export interface AmendedDoc extends DocOut { origNum: string; origDate: string }

export interface DocTax { no: string; kind: "invoice" | "credit_note" | "debit_note"; taxableMinor: bigint; taxMinor: bigint }

export interface Gstr1Model {
  gstin: string; fp: string; grossTurnoverPrevFyMinor: bigint; grossTurnoverCurFyMinor: bigint;
  b2b: Array<{ ctin: string; inv: DocOut[] }>;
  b2cl: Array<{ pos: string; inv: DocOut[] }>;
  b2cs: B2csRow[];
  cdnr: Array<{ ctin: string; nt: NoteOut[] }>;
  cdnur: NoteOut[];
  exp: Array<{ type: "WPAY" | "WOPAY"; inv: DocOut[] }>;
  nil: NilRow[];
  hsn: HsnRow[];
  docIssue: DocIssueRow[];
  at: AdvRow[]; txpd: AdvRow[];
  b2ba: Array<{ ctin: string; inv: AmendedDoc[] }>;
  cdnra: Array<{ ctin: string; nt: Array<NoteOut> }>;
  /** Net TAXED outward by head (invoices + debit notes - credit notes), split non-export vs export-with-tax; used by GSTR-3B + reconciliation. */
  taxedOutward: { taxable: bigint; heads: Heads };
  taxedExport: { taxable: bigint; heads: Heads };
  /** Zero-rated export with no tax (WOPAY / LUT) and nil/0%-rated non-export taxable value. */
  exportNoTaxTaxable: bigint;
  nilTaxable: bigint;
  /** Unregistered inter-state taxed supplies by place of supply (GSTR-3B 3.2). */
  interUnreg: Array<{ pos: string; taxable: bigint; igst: bigint }>;
  docTax: Map<string, DocTax>;
  /** Out-of-s.34-window credit notes: left out of every tax figure (and of the matching gst-ledger rows in GSTR-3B). */
  excludedNoteIds: Set<string>;
  docIndex: Record<string, string>;
  warnings: string[];
}

const dmy = (iso: string): string => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
export { dmy };
const sumTaxable = (b: Bucket[]): bigint => b.reduce((a, x) => a + x.taxable, 0n);
const sumHeads = (b: Bucket[]): Heads => b.reduce<Heads>((a, x) => addHeads(a, x), zeroHeads());

export const docSig = (val: bigint, items: Bucket[], pos: string, ctin: string | undefined): string =>
  `${val}|${sumTaxable(items)}|${headsTotal(sumHeads(items))}|${ctin ?? ""}|${pos}`;

const UQC: Record<string, string> = { NOS: "NOS", PCS: "PCS", PC: "PCS", KG: "KGS", KGS: "KGS", GM: "GMS", GMS: "GMS", MTR: "MTR", M: "MTR", LTR: "LTR", L: "LTR",
  BOX: "BOX", SET: "SET", UNIT: "UNT", UNT: "UNT", DOZ: "DOZ", PAC: "PAC", PRS: "PRS", PAIR: "PRS", TON: "TON", BAG: "BAG", BTL: "BTL", CTN: "CTN", ROL: "ROL", SQM: "SQM", HRS: "OTH" };
const uqcOf = (uom: string | null, hsn: string): string => (hsn.startsWith("99") ? "NA" : UQC[(uom ?? "").trim().toUpperCase()] ?? "OTH");

export interface Gstr1Input {
  cfg: GstrConfig; gstin: string; fp: string; fromDate: string; toDate: string;
  invoices: InvoiceIn[]; notes: NoteIn[]; advances: AdvanceIn[];
  /** Documents issued in the period (for Table 13): invoice numbers / credit-note numbers / debit-note numbers. */
  issuedInvoiceNos: string[]; issuedCreditNos: string[]; issuedDebitNos: string[];
  hsnMaster: HsnMeta[]; prevFyTurnoverMinor: bigint; curFyTurnoverMinor: bigint;
  /** Signature index of earlier prepared runs ("inv:NO" / "nt:NO" -> signature) and which dates they cover, for amendments + late documents. */
  priorIndex: Record<string, string>; priorCoverage: Array<{ from: string; to: string }>;
  /** Documents dated BEFORE the period that an earlier run covers: matched against priorIndex to find late / amended documents. */
  earlierInvoices: InvoiceIn[]; earlierNotes: NoteIn[];
  /** "inv:NO" / "nt:NO" already furnished through an IFF in this quarter: counted in totals + HSN but NOT repeated in B2B / CDNR. */
  iffReported: Set<string>;
}

function toDoc(i: InvoiceIn, items: Bucket[], ctin?: string): DocOut {
  return { num: i.invoiceNo, date: i.invoiceDate, val: i.totalMinor, pos: i.placeOfSupply, rchrg: i.reverseCharge, items, ...(ctin ? { ctin } : {}) };
}
function toNote(n: NoteIn, orig: { total: bigint }, cfg: GstrConfig): NoteOut & { cls: "cdnr" | "cdnur" | "b2cs" | "exp" } {
  const rate = noteRate(n);
  const item: Bucket = { rate, taxable: n.taxableMinor, igst: n.igstMinor, cgst: n.cgstMinor, sgst: n.sgstMinor, cess: n.cessMinor };
  const base = { type: (n.noteType === "credit" ? "C" : "D") as "C" | "D", num: n.noteNo, date: n.noteDate, val: n.totalMinor, pos: n.placeOfSupply, rchrg: false, items: [item], origNum: n.invoiceNo, origDate: n.invoiceDate };
  if (n.placeOfSupply === EXPORT_POS) return { ...base, cls: "exp", exportKind: n.igstMinor + n.cessMinor > 0n ? "EXPWP" : "EXPWOP" };
  if (n.customerGstin) return { ...base, ctin: n.customerGstin, cls: "cdnr" };
  const origCls = classifyInvoice({ customerGstin: null, placeOfSupply: n.placeOfSupply, supplyType: n.supplyType, totalMinor: orig.total }, cfg);
  return { ...base, cls: origCls === "b2cl" ? "cdnur" : "b2cs" };
}

export function buildGstr1(inp: Gstr1Input): Gstr1Model {
  const { cfg } = inp;
  const warnings: string[] = [];
  const priorCovers = (d: string): boolean => inp.priorCoverage.some((c) => d >= c.from && d <= c.to);

  // ---- late documents (dated before the period, covered by an earlier run that lacks them) and amendments (covered, signature changed)
  const lateInvoices: InvoiceIn[] = [];
  const b2baMap = new Map<string, AmendedDoc[]>();
  for (const i of inp.earlierInvoices) {
    const cls = classifyInvoice(i, cfg);
    const prior = inp.priorIndex[`inv:${i.invoiceNo}`];
    if (prior === undefined) { if (priorCovers(i.invoiceDate)) { lateInvoices.push(i); warnings.push(`LATE_DOCUMENT: invoice ${i.invoiceNo} (${i.invoiceDate}) was issued after its period was prepared; reported as an original in this period`); } continue; }
    if (cls !== "b2b") continue;
    const items = bucketsOf(i, false);
    if (prior !== docSig(i.totalMinor, items, i.placeOfSupply, i.customerGstin ?? undefined)) {
      const arr = b2baMap.get(i.customerGstin!) ?? []; arr.push({ ...toDoc(i, items, i.customerGstin!), origNum: i.invoiceNo, origDate: i.invoiceDate }); b2baMap.set(i.customerGstin!, arr);
    }
  }
  const cdnraMap = new Map<string, NoteOut[]>();
  const lateNotes: NoteIn[] = [];
  for (const n of inp.earlierNotes) {
    const prior = inp.priorIndex[`nt:${n.noteNo}`];
    if (prior === undefined) { if (priorCovers(n.noteDate)) { lateNotes.push(n); warnings.push(`LATE_DOCUMENT: note ${n.noteNo} (${n.noteDate}) was issued after its period was prepared; reported as an original in this period`); } continue; }
    const out = toNote(n, { total: n.invoiceTotalMinor }, cfg);
    if (out.cls === "cdnr" && prior !== docSig(out.val, out.items, out.pos, out.ctin)) {
      const arr = cdnraMap.get(out.ctin!) ?? []; arr.push(out); cdnraMap.set(out.ctin!, arr);
    }
  }

  const invoices = [...inp.invoices, ...lateInvoices].sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.invoiceNo.localeCompare(b.invoiceNo));
  const notes = [...inp.notes, ...lateNotes].sort((a, b) => a.noteDate.localeCompare(b.noteDate) || a.noteNo.localeCompare(b.noteNo));

  const b2b = new Map<string, DocOut[]>(); const b2cl = new Map<string, DocOut[]>();
  const expDocs: Record<"WPAY" | "WOPAY", DocOut[]> = { WPAY: [], WOPAY: [] };
  const b2cs = new Map<string, B2csRow>();
  const nilMap = new Map<NilRow["splyTy"], bigint>();
  const docTax = new Map<string, DocTax>();
  const docIndex: Record<string, string> = {};
  const interUnreg = new Map<string, { taxable: bigint; igst: bigint }>();
  let taxedOutward = { taxable: 0n, heads: zeroHeads() };
  let taxedExport = { taxable: 0n, heads: zeroHeads() };
  let exportNoTaxTaxable = 0n; let nilTaxable = 0n;

  const addB2cs = (splyTy: "INTER" | "INTRA", pos: string, b: Bucket, sign: bigint): void => {
    const k = `${splyTy}|${pos}|${b.rate}`;
    const e = b2cs.get(k) ?? { splyTy, rate: b.rate, pos, taxable: 0n, ...zeroHeads() };
    e.taxable += sign * b.taxable; e.igst += sign * b.igst; e.cgst += sign * b.cgst; e.sgst += sign * b.sgst; e.cess += sign * b.cess; b2cs.set(k, e);
  };
  const addInterUnreg = (pos: string, taxable: bigint, igst: bigint): void => {
    const e = interUnreg.get(pos) ?? { taxable: 0n, igst: 0n }; e.taxable += taxable; e.igst += igst; interUnreg.set(pos, e);
  };

  for (const i of invoices) {
    const cls = classifyInvoice(i, cfg);
    const taxedItems = bucketsOf(i, cls === "exp");   // a zero-rated export still lists its 0% rows (WOPAY)
    const posItems = taxedItems.filter((b) => cls === "exp" || !rateIsZero(b.rate));
    // nil / 0%-rated lines of a non-export invoice -> Table 8
    if (cls !== "exp") {
      const nilAmt = i.lines.filter((l) => rateIsZero(l.gstRatePct)).reduce((a, l) => a + l.taxableMinor, 0n);
      if (nilAmt > 0n) {
        const sply: NilRow["splyTy"] = `${i.supplyType === "inter" ? "INTR" : "INTRA"}${i.customerGstin ? "B2B" : "B2C"}` as NilRow["splyTy"];
        nilMap.set(sply, (nilMap.get(sply) ?? 0n) + nilAmt); nilTaxable += nilAmt;
      }
    }
    const taxableTaxed = sumTaxable(posItems); const heads = sumHeads(posItems);
    docTax.set(i.id, { no: i.invoiceNo, kind: "invoice", taxableMinor: taxableTaxed, taxMinor: headsTotal(heads) });
    docIndex[`inv:${i.invoiceNo}`] = docSig(i.totalMinor, posItems, i.placeOfSupply, cls === "b2b" ? i.customerGstin! : undefined);
    if (cls === "exp") {
      const withPay = headsTotal(heads) > 0n;
      expDocs[withPay ? "WPAY" : "WOPAY"].push(toDoc(i, posItems));
      if (withPay) { taxedExport = { taxable: taxedExport.taxable + taxableTaxed, heads: addHeads(taxedExport.heads, heads) }; }
      else exportNoTaxTaxable += taxableTaxed;
      continue;
    }
    if (posItems.length === 0) continue;
    taxedOutward = { taxable: taxedOutward.taxable + taxableTaxed, heads: addHeads(taxedOutward.heads, heads) };
    if (!i.customerGstin && i.supplyType === "inter") addInterUnreg(i.placeOfSupply, taxableTaxed, heads.igst);
    if (cls === "b2b") {
      const d = toDoc(i, posItems, i.customerGstin!);
      if (inp.iffReported.has(`inv:${i.invoiceNo}`)) continue;
      (b2b.get(i.customerGstin!) ?? b2b.set(i.customerGstin!, []).get(i.customerGstin!)!).push(d);
    } else if (cls === "b2cl") {
      const d = toDoc(i, posItems);
      (b2cl.get(i.placeOfSupply) ?? b2cl.set(i.placeOfSupply, []).get(i.placeOfSupply)!).push(d);
    } else {
      for (const b of posItems) addB2cs(i.supplyType === "inter" ? "INTER" : "INTRA", i.placeOfSupply, b, 1n);
    }
  }

  const cdnr = new Map<string, NoteOut[]>(); const cdnur: NoteOut[] = [];
  const excludedNoteIds = new Set<string>();
  for (const n of notes) {
    if (n.noteType === "credit" && !n.withinS34Window) {
      excludedNoteIds.add(n.id);
      warnings.push(`S34_OUT_OF_WINDOW: credit note ${n.noteNo} was issued after the s.34 deadline; its output-tax reduction is excluded from CDNR / GSTR-3B (CA-VERIFY)`);
      continue;
    }
    const sign = n.noteType === "credit" ? -1n : 1n;
    const o = toNote(n, { total: n.invoiceTotalMinor }, cfg);
    const heads = sumHeads(o.items); const taxable = sumTaxable(o.items);
    docTax.set(n.id, { no: n.noteNo, kind: n.noteType === "credit" ? "credit_note" : "debit_note", taxableMinor: sign * taxable, taxMinor: sign * headsTotal(heads) });
    docIndex[`nt:${n.noteNo}`] = docSig(o.val, o.items, o.pos, o.ctin);
    if (headsTotal(heads) === 0n && n.placeOfSupply !== EXPORT_POS) { if (taxable > 0n) { nilTaxable += sign * taxable; } continue; }
    if (o.cls === "exp") {
      if (headsTotal(heads) > 0n) taxedExport = { taxable: taxedExport.taxable + sign * taxable, heads: addHeads(taxedExport.heads, heads, sign) };
      else exportNoTaxTaxable += sign * taxable;
      cdnur.push(o); continue;
    }
    taxedOutward = { taxable: taxedOutward.taxable + sign * taxable, heads: addHeads(taxedOutward.heads, heads, sign) };
    if (!n.customerGstin && n.supplyType === "inter") addInterUnreg(n.placeOfSupply, sign * taxable, sign * heads.igst);
    if (o.cls === "cdnr") { if (!inp.iffReported.has(`nt:${n.noteNo}`)) (cdnr.get(o.ctin!) ?? cdnr.set(o.ctin!, []).get(o.ctin!)!).push(o); }
    else if (o.cls === "cdnur") cdnur.push(o);
    else for (const b of o.items) addB2cs(n.supplyType === "inter" ? "INTER" : "INTRA", n.placeOfSupply, b, sign);
  }

  // ---- HSN summary (Table 12): outward invoices only (notes are not part of Table 12). Per-invoice rounding fixed on the last taxed line.
  const hsnDigits = inp.prevFyTurnoverMinor >= cfg.hsnTurnoverCeilingMinor ? cfg.hsnDigitsAtOrAboveCeiling : cfg.hsnDigitsBelowCeiling;
  const master = new Map(inp.hsnMaster.map((m) => [m.code, m.description] as const));
  const descOf = (code: string, fallback: string): string => master.get(code) ?? master.get(code.slice(0, 4)) ?? master.get(code.slice(0, 2)) ?? fallback;
  const hsn = new Map<string, HsnRow & { qtyN: number }>();
  let missingHsn = 0; let shortHsn = 0;
  for (const i of invoices) {
    const lineHeads = i.lines.map((l) => {
      const tax = l.taxMinor;
      return i.supplyType === "inter" ? { ...zeroHeads(), igst: tax } : (() => { const c = tax / 2n; return { ...zeroHeads(), cgst: c, sgst: tax - c }; })();
    });
    const lastTaxed = (() => { for (let k = i.lines.length - 1; k >= 0; k--) if (i.lines[k]!.taxMinor > 0n) return k; return -1; })();
    if (lastTaxed >= 0) {
      const lh = lineHeads[lastTaxed]!;
      lh.cgst += i.cgstMinor - lineHeads.reduce((a, h) => a + h.cgst, 0n);
      lh.sgst += i.sgstMinor - lineHeads.reduce((a, h) => a + h.sgst, 0n);
      lh.igst += i.igstMinor - lineHeads.reduce((a, h) => a + h.igst, 0n);
      lh.cess += i.cessMinor;
    }
    i.lines.forEach((l, k) => {
      const code = l.hsnSac && l.hsnSac.length > 0 ? l.hsnSac : "NA";
      if (code === "NA") missingHsn++; else if (code.length < hsnDigits) shortHsn++;
      const rate = normRate(l.gstRatePct); const uqc = uqcOf(l.uom, code);
      const key = `${code}|${uqc}|${rate}`;
      const e = hsn.get(key) ?? { hsn: code, desc: descOf(code, l.description).slice(0, 30), uqc, qty: "0", qtyN: 0, val: 0n, taxable: 0n, rate, ...zeroHeads() };
      const h = lineHeads[k]!;
      e.qtyN += uqc === "NA" ? 0 : Number(l.qty); e.taxable += l.taxableMinor; e.val += l.taxableMinor + h.igst + h.cgst + h.sgst + h.cess;
      e.igst += h.igst; e.cgst += h.cgst; e.sgst += h.sgst; e.cess += h.cess; hsn.set(key, e);
    });
  }
  if (missingHsn > 0) warnings.push(`HSN_MISSING: ${missingHsn} invoice line(s) have no HSN/SAC and are reported under "NA"; the portal requires a code`);
  if (shortHsn > 0) warnings.push(`HSN_DIGITS: ${shortHsn} invoice line(s) carry fewer than the ${hsnDigits}-digit HSN required at this turnover (CA-VERIFY)`);
  const hsnRows = [...hsn.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || Number(a.rate) - Number(b.rate)).map(({ qtyN, ...r }) => ({ ...r, qty: String(Math.round(qtyN * 1000) / 1000) }));

  // ---- documents issued (Table 13)
  const series = (nature: string, nos: string[]): DocIssueRow[] => {
    const groups = new Map<string, Array<{ no: string; n: number }>>();
    for (const no of nos) { const m = /^(.*?)(\d+)$/.exec(no); const prefix = m ? m[1]! : no; const n = m ? Number(m[2]) : 0; (groups.get(prefix) ?? groups.set(prefix, []).get(prefix)!).push({ no, n }); }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, g]) => {
      g.sort((a, b) => a.n - b.n);
      const total = g[g.length - 1]!.n - g[0]!.n + 1;
      return { nature, from: g[0]!.no, to: g[g.length - 1]!.no, total: Math.max(total, g.length), cancelled: Math.max(total - g.length, 0), net: g.length };
    });
  };
  const docIssue = [...series("Invoices for outward supply", inp.issuedInvoiceNos), ...series("Debit Note", inp.issuedDebitNos), ...series("Credit Note", inp.issuedCreditNos)];

  // ---- advances (11A received / 11B adjusted)
  const adv = (rows: AdvanceIn[]): AdvRow[] => {
    const m = new Map<string, AdvRow>();
    for (const a of rows) {
      const splyTy = a.supplyType === "inter" ? "INTER" : "INTRA"; const rate = normRate(a.ratePct); const k = `${splyTy}|${a.placeOfSupply}|${rate}`;
      const e = m.get(k) ?? { splyTy, pos: a.placeOfSupply, rate, adAmt: 0n, ...zeroHeads() };
      e.adAmt += a.taxableMinor; e.igst += a.igstMinor; e.cgst += a.cgstMinor; e.sgst += a.sgstMinor; m.set(k, e);
    }
    return [...m.values()].sort((a, b) => a.pos.localeCompare(b.pos) || Number(a.rate) - Number(b.rate));
  };
  const at = adv(inp.advances.filter((a) => a.receiptDate >= inp.fromDate && a.receiptDate <= inp.toDate));
  const txpd = adv(inp.advances.filter((a) => a.adjustedInvoiceDate !== null && a.adjustedInvoiceDate >= inp.fromDate && a.adjustedInvoiceDate <= inp.toDate));

  const nilOrder: NilRow["splyTy"][] = ["INTRB2B", "INTRB2C", "INTRAB2B", "INTRAB2C"];
  if (nilTaxable > 0n) warnings.push("NIL_EXEMPT: every 0%-rated line is reported as nil-rated; exempt and non-GST supplies are not distinguishable in the invoice data (CA-VERIFY)");
  const byStr = <T>(m: Map<string, T[]>): Array<[string, T[]]> => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return {
    gstin: inp.gstin, fp: inp.fp, grossTurnoverPrevFyMinor: inp.prevFyTurnoverMinor, grossTurnoverCurFyMinor: inp.curFyTurnoverMinor,
    b2b: byStr(b2b).map(([ctin, inv]) => ({ ctin, inv })),
    b2cl: byStr(b2cl).map(([pos, inv]) => ({ pos, inv })),
    b2cs: [...b2cs.values()].filter((r) => r.taxable !== 0n || headsTotal(r) !== 0n).sort((a, b) => a.pos.localeCompare(b.pos) || a.splyTy.localeCompare(b.splyTy) || Number(a.rate) - Number(b.rate)),
    cdnr: byStr(cdnr).map(([ctin, nt]) => ({ ctin, nt })),
    cdnur,
    exp: (["WPAY", "WOPAY"] as const).filter((t) => expDocs[t].length > 0).map((type) => ({ type, inv: expDocs[type] })),
    nil: nilOrder.filter((k) => nilMap.has(k)).map((splyTy) => ({ splyTy, nilAmt: nilMap.get(splyTy)! })),
    hsn: hsnRows, docIssue, at, txpd,
    b2ba: byStr(b2baMap).map(([ctin, inv]) => ({ ctin, inv })),
    cdnra: byStr(cdnraMap).map(([ctin, nt]) => ({ ctin, nt })),
    taxedOutward, taxedExport, exportNoTaxTaxable, nilTaxable,
    interUnreg: [...interUnreg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([pos, v]) => ({ pos, ...v })),
    docTax, excludedNoteIds, docIndex, warnings,
  };
}

// ---- GSTR-3B model ---------------------------------------------------------------------------------------------------------------------

export interface DocMeta { pos: string; gstin: string | null; supplyType: "intra" | "inter" | "none" }
export interface Gstr3bInput {
  cfg: GstrConfig; gstin: string; ret: string; fromDate: string; toDate: string; frequency: "monthly" | "quarterly";
  ledger: LedgerRow[]; docMeta: Map<string, DocMeta>; gstr1: Gstr1Model;
  prevFyTurnoverMinor: bigint; filedOn: string | null;
}
export interface Gstr3bModel {
  gstin: string; ret: string;
  osupDet: { taxable: bigint; heads: Heads }; osupZero: { taxable: bigint; heads: Heads }; osupNilExmp: bigint; isupRev: { taxable: bigint; heads: Heads }; osupNongst: bigint;
  unreg: Array<{ pos: string; taxable: bigint; igst: bigint }>;
  itcAvl: { isrc: Heads; oth: Heads }; itcRev: Heads; itcNet: Heads; itcInelg: Heads; pendingRcmItc: Heads;
  inwardExempt: { inter: bigint; intra: bigint };
  payment: { payable: Heads; rcmCash: Heads; itcUsed: { igstToIgst: bigint; igstToCgst: bigint; igstToSgst: bigint; cgstToCgst: bigint; cgstToIgst: bigint; sgstToSgst: bigint; sgstToIgst: bigint; cessToCess: bigint }; cash: Heads; itcCarryForward: Heads };
  interest: Heads; lateFeeCgst: bigint; lateFeeSgst: bigint; dueDate: string; lateDays: number; isNil: boolean;
  warnings: string[];
}

const HEAD_OF: Record<LedgerRow["gstType"], keyof Heads> = { IGST: "igst", CGST: "cgst", SGST: "sgst", CESS: "cess" };
const minB = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export function dueDateOf(toDate: string, frequency: "monthly" | "quarterly", cfg: GstrConfig): string {
  const y = Number(toDate.slice(0, 4)); const m = Number(toDate.slice(5, 7));
  const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(frequency === "monthly" ? cfg.dueDayMonthly : cfg.dueDayQuarterly).padStart(2, "0")}`;
}
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function buildGstr3b(inp: Gstr3bInput): Gstr3bModel {
  const { cfg, gstr1 } = inp;
  const warnings: string[] = [];
  const outward = { taxable: 0n, heads: zeroHeads() }; const zero = { taxable: 0n, heads: zeroHeads() };
  const rcm = { taxable: 0n, heads: zeroHeads() };
  const isrc = zeroHeads(); const oth = zeroHeads(); const inelg = zeroHeads(); const pending = zeroHeads();
  const inRange = (d: string): boolean => d >= inp.fromDate && d <= inp.toDate;
  let unknownDocs = 0;
  for (const r of inp.ledger) {
    if (r.taxMinor === 0n) continue;                       // a nil-tax row never carries a tax figure
    const head = HEAD_OF[r.gstType]; const taxable = r.gstType === "CGST" || r.gstType === "IGST" ? r.taxableMinor : 0n;
    const abs = (v: bigint): bigint => (v < 0n ? -v : v);
    if (r.direction === "output") {
      if (r.sourceDocId !== null && gstr1.excludedNoteIds.has(r.sourceDocId)) continue;
      const sign = r.sourceDocType === "credit_note" ? -1n : 1n;
      const meta = r.sourceDocId ? inp.docMeta.get(r.sourceDocId) : undefined;
      if (!meta) unknownDocs++;
      const bucket = meta?.pos === "96" ? zero : outward;
      bucket.taxable += sign * abs(taxable); bucket.heads[head] += sign * abs(r.taxMinor);
    } else {
      if (r.rcm) {
        if (inRange(r.invoiceDate)) { rcm.taxable += abs(taxable); rcm.heads[head] += abs(r.taxMinor); }
        if (r.itcCategory === "eligible") {
          if (r.rcmItcClaimedOn !== null) { if (inRange(r.rcmItcClaimedOn)) isrc[head] += abs(r.taxMinor); }
          else if (inRange(r.invoiceDate)) pending[head] += abs(r.taxMinor);
        } else if ((r.itcCategory === "ineligible" || r.itcCategory === "blocked") && inRange(r.invoiceDate)) inelg[head] += abs(r.taxMinor);
      } else if (inRange(r.invoiceDate)) {
        if (r.itcCategory === "eligible") oth[head] += abs(r.taxMinor);
        else if (r.itcCategory === "ineligible" || r.itcCategory === "blocked") inelg[head] += abs(r.taxMinor);
      }
    }
  }
  if (unknownDocs > 0) warnings.push(`LEDGER_ORPHAN: ${unknownDocs} output ledger row(s) point at no document in this period; treated as non-export outward supplies`);
  if (headsTotal(pending) > 0n) warnings.push("RCM_ITC_PENDING: reverse-charge ITC awaiting payment of the RCM tax is not claimed in 4A(3) until paid");
  zero.taxable += gstr1.exportNoTaxTaxable;
  warnings.push("ITC_REVERSALS: Rule 42/43 and s.17(5) reversals (4B) are not computed in v1; 4B is reported as nil (CA-VERIFY)");
  warnings.push("INWARD_EXEMPT: section 5 (inward exempt / nil / non-GST) is not derivable from the tax ledger in v1 and is reported as nil");

  const itcNet: Heads = addHeads(addHeads(zeroHeads(), isrc), oth);
  // ---- 6.1 payment: liability, then ITC utilisation in the statutory order (IGST first against IGST, CGST, SGST; CGST against CGST, IGST; SGST against SGST, IGST; cess only against cess)
  const payable = addHeads(addHeads(zeroHeads(), outward.heads), zero.heads);
  const L = { ...payable }; const A = { ...itcNet };
  const use = { igstToIgst: 0n, igstToCgst: 0n, igstToSgst: 0n, cgstToCgst: 0n, cgstToIgst: 0n, sgstToSgst: 0n, sgstToIgst: 0n, cessToCess: 0n };
  const clampL = (v: bigint): bigint => (v < 0n ? 0n : v);
  for (const k of ["igst", "cgst", "sgst", "cess"] as const) L[k] = clampL(L[k]);
  use.igstToIgst = minB(A.igst, L.igst); A.igst -= use.igstToIgst; L.igst -= use.igstToIgst;
  use.igstToCgst = minB(A.igst, L.cgst); A.igst -= use.igstToCgst; L.cgst -= use.igstToCgst;
  use.igstToSgst = minB(A.igst, L.sgst); A.igst -= use.igstToSgst; L.sgst -= use.igstToSgst;
  use.cgstToCgst = minB(A.cgst, L.cgst); A.cgst -= use.cgstToCgst; L.cgst -= use.cgstToCgst;
  use.cgstToIgst = minB(A.cgst, L.igst); A.cgst -= use.cgstToIgst; L.igst -= use.cgstToIgst;
  use.sgstToSgst = minB(A.sgst, L.sgst); A.sgst -= use.sgstToSgst; L.sgst -= use.sgstToSgst;
  use.sgstToIgst = minB(A.sgst, L.igst); A.sgst -= use.sgstToIgst; L.igst -= use.sgstToIgst;
  use.cessToCess = minB(A.cess, L.cess); A.cess -= use.cessToCess; L.cess -= use.cessToCess;
  const cash: Heads = { igst: L.igst + rcm.heads.igst, cgst: L.cgst + rcm.heads.cgst, sgst: L.sgst + rcm.heads.sgst, cess: L.cess + rcm.heads.cess };

  // ---- 5.1 interest + late fee (only when a filing date is supplied)
  const dueDate = dueDateOf(inp.toDate, inp.frequency, cfg);
  const lateDays = inp.filedOn ? Math.max(daysBetween(dueDate, inp.filedOn), 0) : 0;
  const interest = zeroHeads();
  const isNil = headsTotal(payable) === 0n && headsTotal(rcm.heads) === 0n && outward.taxable === 0n && zero.taxable === 0n && gstr1.nilTaxable === 0n;
  let lateFee = 0n;
  if (lateDays > 0) {
    for (const k of ["igst", "cgst", "sgst", "cess"] as const) interest[k] = (cash[k] * cfg.interestBps * BigInt(lateDays) * 2n + 10000n * 365n) / (10000n * 365n * 2n);
    if (isNil) lateFee = minB(cfg.lateFeeNilPerDayMinor * BigInt(lateDays), cfg.lateFeeNilCapMinor);
    else {
      const band = cfg.lateFeeBands.find((b) => b.upToTurnoverMinor === null || inp.prevFyTurnoverMinor <= b.upToTurnoverMinor)!;
      lateFee = minB(cfg.lateFeePerDayMinor * BigInt(lateDays), band.capMinor);
    }
  }
  const half = lateFee / 2n;

  return {
    gstin: inp.gstin, ret: inp.ret,
    osupDet: outward, osupZero: zero, osupNilExmp: gstr1.nilTaxable, isupRev: rcm, osupNongst: 0n,
    unreg: gstr1.interUnreg.filter((u) => u.taxable !== 0n || u.igst !== 0n),
    itcAvl: { isrc, oth }, itcRev: zeroHeads(), itcNet, itcInelg: inelg, pendingRcmItc: pending, inwardExempt: { inter: 0n, intra: 0n },
    payment: { payable, rcmCash: rcm.heads, itcUsed: use, cash, itcCarryForward: A },
    interest, lateFeeCgst: half, lateFeeSgst: lateFee - half, dueDate, lateDays, isNil, warnings,
  };
}

// ---- reconciliation -------------------------------------------------------------------------------------------------------------------

export interface ReconCheck { name: string; gstr1Minor: bigint; gstr3bMinor: bigint; diffMinor: bigint; ok: boolean }
export interface Reconciliation { ok: boolean; checks: ReconCheck[]; unmatchedDocs: Array<{ docId: string; docNo: string; gstr1TaxMinor: bigint; ledgerTaxMinor: bigint }>; note: string }

/** GSTR-1 (built from the invoices) must agree head-by-head with GSTR-3B 3.1(a)+(b) (built from the gst ledger); per-document differences are listed. */
export function reconcile(g1: Gstr1Model, g3: Gstr3bModel, ledger: LedgerRow[]): Reconciliation {
  const mk = (name: string, a: bigint, b: bigint): ReconCheck => ({ name, gstr1Minor: a, gstr3bMinor: b, diffMinor: b - a, ok: a === b });
  const g1Heads = addHeads(g1.taxedOutward.heads, g1.taxedExport.heads); const g3Heads = addHeads(g3.osupDet.heads, g3.osupZero.heads);
  const g3TaxableTaxed = g3.osupDet.taxable + g3.osupZero.taxable - g1.exportNoTaxTaxable;
  const checks = [
    mk("taxable value (taxed outward + zero-rated with tax)", g1.taxedOutward.taxable + g1.taxedExport.taxable, g3TaxableTaxed),
    mk("IGST", g1Heads.igst, g3Heads.igst), mk("CGST", g1Heads.cgst, g3Heads.cgst), mk("SGST", g1Heads.sgst, g3Heads.sgst), mk("CESS", g1Heads.cess, g3Heads.cess),
    mk("nil / exempt + zero-rated-no-tax taxable (same source both sides)", g1.nilTaxable + g1.exportNoTaxTaxable, g3.osupNilExmp + g1.exportNoTaxTaxable),
  ];
  const led = new Map<string, bigint>();
  for (const r of inp0(ledger)) { if (g1.excludedNoteIds.has(r.sourceDocId!)) continue; const s = r.sourceDocType === "credit_note" ? -1n : 1n; const v = r.taxMinor < 0n ? -r.taxMinor : r.taxMinor; led.set(r.sourceDocId!, (led.get(r.sourceDocId!) ?? 0n) + s * v); }
  const unmatched: Reconciliation["unmatchedDocs"] = [];
  for (const [id, d] of g1.docTax) { const l = led.get(id) ?? 0n; if (l !== d.taxMinor) unmatched.push({ docId: id, docNo: d.no, gstr1TaxMinor: d.taxMinor, ledgerTaxMinor: l }); led.delete(id); }
  for (const [id, l] of led) if (l !== 0n) unmatched.push({ docId: id, docNo: "(no document in this period)", gstr1TaxMinor: 0n, ledgerTaxMinor: l });
  return { ok: checks.every((c) => c.ok) && unmatched.length === 0, checks, unmatchedDocs: unmatched, note: "GSTR-1 is built from ar.sales_invoices / notes; GSTR-3B 3.1 from gl.finance_gst_ledger (output)" };
}
const inp0 = (ledger: LedgerRow[]): LedgerRow[] => ledger.filter((r) => r.direction === "output" && r.sourceDocId !== null && r.taxMinor !== 0n);
