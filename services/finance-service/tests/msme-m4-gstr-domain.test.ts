/**
 * MSME commercial M4 -- pure builders (no DB). GSTR-1 bucketing (B2B / B2CL / B2CS / CDNR / CDNUR / export / nil), HSN summary totals,
 * documents issued, advances, late-document + amendment detection, GSTR-3B sections (3.1 / 3.2 / 4 / 6 / interest / late fee) and the
 * GSTR-1 <-> GSTR-3B reconciliation, plus the pinned JSON adapter shape. Seeds both ledger directions directly.
 */
import { describe, it, expect } from "vitest";
import { GSTR_CONFIG, GSTR_JSON_SCHEMA_VERSION } from "../src/modules/gst-returns/config.js";
import { getAdapter, supportedVersions } from "../src/modules/gst-returns/adapters.js";
import { periodRange, fyStartOf } from "../src/modules/gst-returns/service.js";
import {
  buildGstr1, buildGstr3b, reconcile, classifyInvoice, bucketsOf, noteRate, dueDateOf,
  type InvoiceIn, type NoteIn, type LedgerRow, type DocMeta, type Gstr1Input, type AdvanceIn,
} from "../src/modules/gst-returns/domain.js";

const GSTIN = "29ABCDE1234F1Z5"; // Karnataka
const CFG = GSTR_CONFIG;
let n = 0;
const id = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function inv(o: { no: string; date?: string; gstin?: string | null; pos?: string; lines: Array<{ hsn?: string | null; taxable: bigint; rate: string; uom?: string; qty?: string }> }): InvoiceIn {
  const pos = o.pos ?? "29"; const supplyType = pos === "29" ? "intra" : "inter";
  const lines = o.lines.map((l) => {
    const tax = (l.taxable * BigInt(Math.round(Number(l.rate) * 100))) / 10000n;
    return { hsnSac: l.hsn === undefined ? "4820" : l.hsn, description: "item", qty: l.qty ?? "1", uom: l.uom ?? "NOS", taxableMinor: l.taxable, gstRatePct: l.rate, taxMinor: tax };
  });
  const taxable = lines.reduce((a, l) => a + l.taxableMinor, 0n); const tax = lines.reduce((a, l) => a + l.taxMinor, 0n);
  const cgst = supplyType === "intra" ? tax / 2n : 0n; const sgst = supplyType === "intra" ? tax - cgst : 0n; const igst = supplyType === "inter" ? tax : 0n;
  return { id: id(), invoiceNo: o.no, invoiceDate: o.date ?? "2026-11-10", customerGstin: o.gstin === undefined ? null : o.gstin, placeOfSupply: pos, supplyType, reverseCharge: false,
    taxableMinor: taxable, cgstMinor: cgst, sgstMinor: sgst, igstMinor: igst, cessMinor: 0n, totalMinor: taxable + tax, lines };
}
function note(i: InvoiceIn, o: { no: string; type: "credit" | "debit"; taxable: bigint; rate: string; date?: string; within?: boolean }): NoteIn {
  const tax = (o.taxable * BigInt(Math.round(Number(o.rate) * 100))) / 10000n;
  const intra = i.supplyType === "intra";
  return { id: id(), noteNo: o.no, noteType: o.type, noteDate: o.date ?? "2026-11-20", invoiceId: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, customerGstin: i.customerGstin,
    placeOfSupply: i.placeOfSupply, supplyType: i.supplyType, invoiceTotalMinor: i.totalMinor, withinS34Window: o.within ?? true, taxableMinor: o.taxable, cgstMinor: intra ? tax / 2n : 0n, sgstMinor: intra ? tax - tax / 2n : 0n,
    igstMinor: intra ? 0n : tax, cessMinor: 0n, totalMinor: o.taxable + tax };
}
const base = (over: Partial<Gstr1Input>): Gstr1Input => ({
  cfg: CFG, gstin: GSTIN, fp: "112026", fromDate: "2026-11-01", toDate: "2026-11-30", invoices: [], notes: [], advances: [], issuedInvoiceNos: [], issuedCreditNos: [], issuedDebitNos: [],
  hsnMaster: [{ code: "4820", description: "Registers, account books" }], prevFyTurnoverMinor: 0n, curFyTurnoverMinor: 0n, priorIndex: {}, priorCoverage: [], earlierInvoices: [], earlierNotes: [],
  iffReported: new Set(), ...over,
});
/** The ledger rows an output posting would write: one per tax head, taxable carried on the CGST / IGST row (and repeated on SGST). */
function outRows(i: InvoiceIn, docType = "sales_invoice", sourceId = i.id, date = i.invoiceDate): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const mk = (gstType: LedgerRow["gstType"], tax: bigint): void => { if (tax > 0n) rows.push({ direction: "output", gstType, taxableMinor: i.taxableMinor, taxMinor: tax, invoiceDate: date, sourceDocType: docType, sourceDocId: sourceId, rcm: false, itcCategory: null, rcmItcClaimedOn: null }); };
  mk("CGST", i.cgstMinor); mk("SGST", i.sgstMinor); mk("IGST", i.igstMinor); mk("CESS", i.cessMinor);
  return rows;
}
const noteRows = (nt: NoteIn): LedgerRow[] => outRows({ taxableMinor: nt.taxableMinor, cgstMinor: nt.cgstMinor, sgstMinor: nt.sgstMinor, igstMinor: nt.igstMinor, cessMinor: nt.cessMinor, invoiceDate: nt.noteDate } as InvoiceIn, nt.noteType === "credit" ? "credit_note" : "debit_note", nt.id, nt.noteDate);
const inRow = (gstType: LedgerRow["gstType"], taxable: bigint, tax: bigint, o: Partial<LedgerRow> = {}): LedgerRow =>
  ({ direction: "input", gstType, taxableMinor: taxable, taxMinor: tax, invoiceDate: "2026-11-05", sourceDocType: "bill", sourceDocId: id(), rcm: false, itcCategory: "eligible", rcmItcClaimedOn: null, ...o });

describe("config pins", () => {
  it("pins the JSON schema version and registers an adapter for it; unknown versions are refused", () => {
    expect(GSTR_JSON_SCHEMA_VERSION).toBe("GST3.1");
    expect(supportedVersions()).toContain(GSTR_JSON_SCHEMA_VERSION);
    expect(() => getAdapter("GST9.9")).toThrow(/GSTR_JSON_VERSION_UNSUPPORTED/);
  });
  it("B2CL threshold, QRMP ceiling and late-fee caps are config (paise)", () => {
    expect(CFG.b2clThresholdMinor).toBe(10_000_000n); expect(CFG.qrmpTurnoverCeilingMinor).toBe(5_000_000_000n); expect(CFG.interestBps).toBe(1800n);
  });
  it("monthly vs QRMP period ranges: quarter-end = periodic over 3 months, other months = IFF", () => {
    expect(periodRange("2026-11", "monthly")).toMatchObject({ kind: "periodic", from: "2026-11-01", to: "2026-11-30" });
    expect(periodRange("2026-12", "quarterly")).toMatchObject({ kind: "periodic", from: "2026-10-01", to: "2026-12-31", fp: "122026" });
    expect(periodRange("2026-11", "quarterly")).toMatchObject({ kind: "iff", from: "2026-11-01", to: "2026-11-30" });
    expect(fyStartOf("2026-03-31")).toBe("2025-04-01"); expect(fyStartOf("2026-04-01")).toBe("2026-04-01");
  });
});

describe("GSTR-1 bucketing", () => {
  const b2b = inv({ no: "INV/001", gstin: "27AAAAA0000A1Z5", pos: "27", lines: [{ taxable: 100000n, rate: "18" }, { taxable: 50000n, rate: "5", hsn: "4901" }] });
  const b2bIntra = inv({ no: "INV/002", gstin: "29AAAAA0000A1Z5", lines: [{ taxable: 100001n, rate: "18" }] });
  const b2clBig = inv({ no: "INV/003", pos: "07", lines: [{ taxable: 20_000_000n, rate: "18" }] });   // Rs 2 lakh inter-state B2C
  const b2clEdge = inv({ no: "INV/004", pos: "07", lines: [{ taxable: 8_500_000n, rate: "18" }] });  // total just above 1 lakh? computed below
  const b2csSmall = inv({ no: "INV/005", pos: "07", lines: [{ taxable: 5_000_000n, rate: "18" }] });  // inter, below threshold
  const b2csIntra = inv({ no: "INV/006", lines: [{ taxable: 30_000_000n, rate: "12" }] });            // intra, large -> still B2CS
  const exportWp = inv({ no: "INV/007", pos: "96", lines: [{ taxable: 1_000_000n, rate: "18" }] });
  const exportWop = inv({ no: "INV/008", pos: "96", lines: [{ taxable: 700_000n, rate: "0" }] });
  const nilB2b = inv({ no: "INV/009", gstin: "27AAAAA0000A1Z5", pos: "27", lines: [{ taxable: 40_000n, rate: "0" }, { taxable: 10_000n, rate: "12" }] });

  it("classifies by GSTIN presence, then inter-state value over the threshold, then export", () => {
    expect(classifyInvoice(b2b, CFG)).toBe("b2b");
    expect(classifyInvoice(b2clBig, CFG)).toBe("b2cl");
    expect(b2clEdge.totalMinor).toBeGreaterThan(CFG.b2clThresholdMinor);
    expect(classifyInvoice(b2clEdge, CFG)).toBe("b2cl");
    expect(classifyInvoice(b2csSmall, CFG)).toBe("b2cs");
    expect(classifyInvoice(b2csIntra, CFG)).toBe("b2cs");           // intra-state is never B2CL
    expect(classifyInvoice(exportWp, CFG)).toBe("exp");
    expect(classifyInvoice({ ...b2clBig, totalMinor: CFG.b2clThresholdMinor }, CFG)).toBe("b2cs");   // strictly above
    expect(classifyInvoice({ ...b2clBig, totalMinor: CFG.b2clThresholdMinor + 1n }, CFG)).toBe("b2cl");
  });

  const all = [b2b, b2bIntra, b2clBig, b2clEdge, b2csSmall, b2csIntra, exportWp, exportWop, nilB2b];
  const g = buildGstr1(base({ invoices: all, issuedInvoiceNos: all.map((i) => i.invoiceNo) }));

  it("fills B2B (per ctin, per rate), B2CL (per pos), B2CS (aggregated), exports (WPAY / WOPAY) and nil", () => {
    expect(g.b2b.map((c) => c.ctin)).toEqual(["27AAAAA0000A1Z5", "29AAAAA0000A1Z5"]);
    const first = g.b2b[0]!.inv.find((d) => d.num === "INV/001")!;
    expect(first.items.map((b) => b.rate)).toEqual(["5", "18"]);
    expect(first.items.map((b) => b.igst)).toEqual([2500n, 18000n]);
    expect(g.b2b[0]!.inv.find((d) => d.num === "INV/009")!.items.map((b) => b.rate)).toEqual(["12"]);   // the 0% line is NOT in B2B
    expect(g.b2cl).toHaveLength(1); expect(g.b2cl[0]!.pos).toBe("07"); expect(g.b2cl[0]!.inv.map((d) => d.num)).toEqual(["INV/003", "INV/004"]);
    expect(g.b2cs.map((r) => `${r.splyTy}|${r.pos}|${r.rate}`)).toEqual(["INTER|07|18", "INTRA|29|12"]);
    expect(g.exp.map((e) => e.type)).toEqual(["WPAY", "WOPAY"]);
    expect(g.nil).toEqual([{ splyTy: "INTRB2B", nilAmt: 40_000n }]);
  });
  it("intra-state B2B keeps CGST = SGST rounding on the stored invoice heads", () => {
    const d = g.b2b[1]!.inv[0]!;
    expect(d.items[0]!.cgst + d.items[0]!.sgst).toBe(b2bIntra.cgstMinor + b2bIntra.sgstMinor);
    expect(d.items[0]!.igst).toBe(0n);
  });
  it("HSN summary: every line is in it, and its taxable + tax totals equal the invoice totals", () => {
    const taxable = all.reduce((a, i) => a + i.taxableMinor, 0n);
    const igst = all.reduce((a, i) => a + i.igstMinor, 0n); const cgst = all.reduce((a, i) => a + i.cgstMinor, 0n); const sgst = all.reduce((a, i) => a + i.sgstMinor, 0n);
    expect(g.hsn.reduce((a, h) => a + h.taxable, 0n)).toBe(taxable);
    expect(g.hsn.reduce((a, h) => a + h.igst, 0n)).toBe(igst);
    expect(g.hsn.reduce((a, h) => a + h.cgst, 0n)).toBe(cgst);
    expect(g.hsn.reduce((a, h) => a + h.sgst, 0n)).toBe(sgst);
    expect(g.hsn.reduce((a, h) => a + h.val, 0n)).toBe(all.reduce((a, i) => a + i.totalMinor, 0n));
    expect(g.hsn.find((h) => h.hsn === "4820")!.desc).toBe("Registers, account books");
    expect(g.hsn.find((h) => h.hsn === "4901")).toBeTruthy();
  });
  it("HSN digits: 4 below the turnover ceiling, 6 at or above; short codes warn; missing codes are reported under NA", () => {
    const six = buildGstr1(base({ invoices: [inv({ no: "X/1", lines: [{ taxable: 1000n, rate: "18", hsn: "4820" }, { taxable: 1000n, rate: "18", hsn: null }] })], prevFyTurnoverMinor: CFG.hsnTurnoverCeilingMinor }));
    expect(six.warnings.join()).toMatch(/HSN_DIGITS.*6-digit/); expect(six.warnings.join()).toMatch(/HSN_MISSING/);
    expect(six.hsn.some((h) => h.hsn === "NA")).toBe(true);
  });
  it("documents issued: series, from / to, total, cancelled (gap) and net", () => {
    const d = buildGstr1(base({ issuedInvoiceNos: ["INV/26-27/00001", "INV/26-27/00002", "INV/26-27/00004"], issuedCreditNos: ["CN/26-27/00001"], issuedDebitNos: [] }));
    expect(d.docIssue).toEqual([
      { nature: "Invoices for outward supply", from: "INV/26-27/00001", to: "INV/26-27/00004", total: 4, cancelled: 1, net: 3 },
      { nature: "Credit Note", from: "CN/26-27/00001", to: "CN/26-27/00001", total: 1, cancelled: 0, net: 1 },
    ]);
  });
});

describe("credit / debit notes: CDNR, CDNUR, B2CS netting", () => {
  const reg = inv({ no: "R/1", gstin: "27AAAAA0000A1Z5", pos: "27", lines: [{ taxable: 100000n, rate: "18" }] });
  const big = inv({ no: "L/1", pos: "07", lines: [{ taxable: 20_000_000n, rate: "18" }] });
  const small = inv({ no: "S/1", pos: "07", lines: [{ taxable: 5_000_000n, rate: "18" }] });
  const cnReg = note(reg, { no: "CN/1", type: "credit", taxable: 10000n, rate: "18" });
  const dnReg = note(reg, { no: "DN/1", type: "debit", taxable: 2000n, rate: "18" });
  const cnBig = note(big, { no: "CN/2", type: "credit", taxable: 1_000_000n, rate: "18" });
  const cnSmall = note(small, { no: "CN/3", type: "credit", taxable: 1_000_000n, rate: "18" });
  const g = buildGstr1(base({ invoices: [reg, big, small], notes: [cnReg, dnReg, cnBig, cnSmall] }));
  it("registered-recipient notes go to CDNR; notes against a B2CL invoice go to CDNUR; other B2C notes net the B2CS row", () => {
    expect(g.cdnr).toHaveLength(1);
    expect(g.cdnr[0]!.nt.map((x) => `${x.type}:${x.num}`)).toEqual(["C:CN/1", "D:DN/1"]);
    expect(g.cdnur.map((x) => x.num)).toEqual(["CN/2"]);
    const row = g.b2cs.find((r) => r.pos === "07" && r.rate === "18")!;
    expect(row.taxable).toBe(5_000_000n - 1_000_000n); expect(row.igst).toBe(900_000n - 180_000n);
  });
  it("net taxed outward = invoices + debit notes - credit notes", () => {
    const tax = (x: { taxableMinor: bigint }) => x.taxableMinor;
    expect(g.taxedOutward.taxable).toBe(tax(reg) + tax(big) + tax(small) - cnReg.taxableMinor + dnReg.taxableMinor - cnBig.taxableMinor - cnSmall.taxableMinor);
    expect(g.taxedOutward.heads.igst).toBe(reg.igstMinor + big.igstMinor + small.igstMinor - cnReg.igstMinor + dnReg.igstMinor - cnBig.igstMinor - cnSmall.igstMinor);
  });
  it("derives the note rate from tax / taxable", () => { expect(noteRate(cnReg)).toBe("18"); expect(noteRate(note(inv({ no: "Q/1", lines: [{ taxable: 100000n, rate: "5" }] }), { no: "CN/9", type: "credit", taxable: 100000n, rate: "5" }))).toBe("5"); });
});

describe("s.34 window", () => {
  const reg = inv({ no: "W/1", gstin: "27AAAAA0000A1Z5", pos: "27", lines: [{ taxable: 100000n, rate: "18" }] });
  const late = note(reg, { no: "CN/L", type: "credit", taxable: 10000n, rate: "18", within: false });
  const ok = note(reg, { no: "CN/K", type: "credit", taxable: 5000n, rate: "18" });
  const g1 = buildGstr1(base({ invoices: [reg], notes: [late, ok] }));
  it("an out-of-window credit note is flagged and excluded from CDNR + the tax reduction, in GSTR-1 and in GSTR-3B (negative ledger rows ignored)", () => {
    expect(g1.cdnr[0]!.nt.map((x) => x.num)).toEqual(["CN/K"]);
    expect(g1.warnings.join()).toMatch(/S34_OUT_OF_WINDOW: credit note CN\/L/);
    expect(g1.taxedOutward.taxable).toBe(100000n - 5000n);
    const neg = (x: NoteIn): LedgerRow[] => noteRows(x).map((r) => ({ ...r, taxableMinor: -r.taxableMinor, taxMinor: -r.taxMinor }));   // M3b writes credit-note rows NEGATIVE
    const ledger = [...outRows(reg), ...neg(late), ...neg(ok)];
    const docMeta = new Map<string, DocMeta>([[reg.id, { pos: "27", gstin: reg.customerGstin, supplyType: "inter" }], [ok.id, { pos: "27", gstin: reg.customerGstin, supplyType: "inter" }], [late.id, { pos: "27", gstin: reg.customerGstin, supplyType: "inter" }]]);
    const g3 = buildGstr3b({ cfg: CFG, gstin: GSTIN, ret: "112026", fromDate: "2026-11-01", toDate: "2026-11-30", frequency: "monthly", ledger, docMeta, gstr1: g1, prevFyTurnoverMinor: 0n, filedOn: null });
    expect(g3.osupDet.heads.igst).toBe(reg.igstMinor - ok.igstMinor);
    expect(reconcile(g1, g3, ledger).ok).toBe(true);
  });
});

describe("advances (11A / 11B)", () => {
  const adv = (receipt: string, adj: string | null, taxable: bigint): AdvanceIn => ({ id: id(), receiptDate: receipt, placeOfSupply: "27", supplyType: "inter", ratePct: "18", taxableMinor: taxable, cgstMinor: 0n, sgstMinor: 0n, igstMinor: taxable * 18n / 100n, adjustedInvoiceDate: adj });
  it("received-in-period go to AT, adjusted-in-period go to TXPD", () => {
    const g = buildGstr1(base({ advances: [adv("2026-11-03", null, 100000n), adv("2026-10-20", "2026-11-12", 50000n), adv("2026-11-04", "2026-11-18", 20000n)] }));
    expect(g.at.reduce((a, r) => a + r.adAmt, 0n)).toBe(120000n);
    expect(g.txpd.reduce((a, r) => a + r.adAmt, 0n)).toBe(70000n);
  });
});

describe("amendments + late documents + IFF", () => {
  const sigOf = (i: InvoiceIn): string => buildGstr1(base({ invoices: [i] })).docIndex[`inv:${i.invoiceNo}`]!;
  const early = inv({ no: "E/1", date: "2026-10-05", gstin: "27AAAAA0000A1Z5", pos: "27", lines: [{ taxable: 100000n, rate: "18" }] });
  const cover = [{ from: "2026-10-01", to: "2026-10-31" }];
  it("an earlier-period document absent from the covering run is reported once as a late original", () => {
    const g = buildGstr1(base({ earlierInvoices: [early], priorCoverage: cover, priorIndex: {} }));
    expect(g.b2b[0]!.inv.map((d) => d.num)).toEqual(["E/1"]);
    expect(g.warnings.join()).toMatch(/LATE_DOCUMENT: invoice E\/1/);
  });
  it("an earlier-period B2B document whose signature changed goes to B2BA (with the original number); an unchanged one is silent", () => {
    const changed = buildGstr1(base({ earlierInvoices: [early], priorCoverage: cover, priorIndex: { "inv:E/1": "stale-signature" } }));
    expect(changed.b2ba[0]!.inv[0]).toMatchObject({ num: "E/1", origNum: "E/1" }); expect(changed.b2b).toEqual([]);
    const same = buildGstr1(base({ earlierInvoices: [early], priorCoverage: cover, priorIndex: { "inv:E/1": sigOf(early) } }));
    expect(same.b2ba).toEqual([]); expect(same.b2b).toEqual([]);
  });
  it("a document already furnished through the IFF is not repeated in B2B but still counts in totals + HSN", () => {
    const i = inv({ no: "F/1", gstin: "27AAAAA0000A1Z5", pos: "27", lines: [{ taxable: 100000n, rate: "18" }] });
    const g = buildGstr1(base({ invoices: [i], iffReported: new Set(["inv:F/1"]) }));
    expect(g.b2b).toEqual([]); expect(g.taxedOutward.taxable).toBe(100000n); expect(g.hsn[0]!.taxable).toBe(100000n);
  });
});

describe("GSTR-3B + reconciliation to GSTR-1", () => {
  const i1 = inv({ no: "A/1", gstin: "27AAAAA0000A1Z5", pos: "27", lines: [{ taxable: 100000n, rate: "18" }, { taxable: 50000n, rate: "5" }] });
  const i2 = inv({ no: "A/2", gstin: "29AAAAA0000A1Z5", lines: [{ taxable: 200000n, rate: "12" }] });
  const i3 = inv({ no: "A/3", pos: "07", lines: [{ taxable: 8_000_000n, rate: "18" }] });
  const iX = inv({ no: "A/4", pos: "96", lines: [{ taxable: 500_000n, rate: "18" }] });
  const iXn = inv({ no: "A/5", pos: "96", lines: [{ taxable: 300_000n, rate: "0" }] });
  const iNil = inv({ no: "A/6", lines: [{ taxable: 60_000n, rate: "0" }] });
  const cn = note(i2, { no: "CN/1", type: "credit", taxable: 20000n, rate: "12" });
  const invoices = [i1, i2, i3, iX, iXn, iNil];
  const g1 = buildGstr1(base({ invoices, notes: [cn] }));
  const outLedger = [...invoices.flatMap((i) => outRows(i)), ...noteRows(cn)];
  const rcmBill = id();
  const inLedger: LedgerRow[] = [
    inRow("CGST", 400000n, 36000n), inRow("SGST", 400000n, 36000n), inRow("IGST", 100000n, 18000n),
    inRow("CGST", 50000n, 4500n, { itcCategory: "ineligible" }),
    inRow("IGST", 200000n, 36000n, { rcm: true, sourceDocId: rcmBill, rcmItcClaimedOn: "2026-11-25" }),   // RCM, paid in period -> 4A(3) + 3.1(d)
    inRow("IGST", 100000n, 18000n, { rcm: true, itcCategory: "eligible", rcmItcClaimedOn: null }),         // RCM, unpaid -> 3.1(d) only, pending ITC
  ];
  const docMeta = new Map<string, DocMeta>([...invoices.map((i) => [i.id, { pos: i.placeOfSupply, gstin: i.customerGstin, supplyType: i.supplyType }] as const), [cn.id, { pos: cn.placeOfSupply, gstin: cn.customerGstin, supplyType: cn.supplyType }]]);
  const in3 = (ledger: LedgerRow[], filedOn: string | null = null, prev = 0n) =>
    ({ cfg: CFG, gstin: GSTIN, ret: "112026", fromDate: "2026-11-01", toDate: "2026-11-30", frequency: "monthly" as const, ledger, docMeta, gstr1: g1, prevFyTurnoverMinor: prev, filedOn });
  const g3 = buildGstr3b(in3([...outLedger, ...inLedger]));

  it("3.1(a) outward, (b) zero-rated, (c) nil, (d) RCM, 3.2 inter-state to unregistered", () => {
    expect(g3.osupDet.heads.igst + g3.osupDet.heads.cgst + g3.osupDet.heads.sgst).toBe(g1.taxedOutward.heads.igst + g1.taxedOutward.heads.cgst + g1.taxedOutward.heads.sgst);
    expect(g3.osupZero.heads.igst).toBe(iX.igstMinor);
    expect(g3.osupZero.taxable).toBe(iX.taxableMinor + iXn.taxableMinor);          // WPAY from the ledger + WOPAY from the invoices
    expect(g3.osupNilExmp).toBe(60_000n);
    expect(g3.isupRev.heads.igst).toBe(36000n + 18000n); expect(g3.isupRev.taxable).toBe(300000n);
    expect(g3.unreg).toEqual([{ pos: "07", taxable: i3.taxableMinor, igst: i3.igstMinor }]);
  });
  it("4A(3) takes RCM ITC only once paid, 4A(5) the other eligible ITC, 4D the ineligible; pending RCM ITC is warned", () => {
    expect(g3.itcAvl.isrc.igst).toBe(36000n);
    expect(g3.itcAvl.oth).toMatchObject({ cgst: 36000n, sgst: 36000n, igst: 18000n });
    expect(g3.itcInelg.cgst).toBe(4500n);
    expect(g3.pendingRcmItc.igst).toBe(18000n);
    expect(g3.warnings.join()).toMatch(/RCM_ITC_PENDING/);
  });
  it("6.1: liability, ITC utilised in the statutory order, RCM tax in cash, never negative", () => {
    const p = g3.payment;
    expect(p.itcUsed.igstToIgst).toBeGreaterThan(0n);
    expect(p.cash.igst).toBeGreaterThanOrEqual(p.rcmCash.igst);
    for (const k of ["igst", "cgst", "sgst", "cess"] as const) { expect(p.cash[k]).toBeGreaterThanOrEqual(0n); expect(p.itcCarryForward[k]).toBeGreaterThanOrEqual(0n); }
    // conservation: payable + rcm = used + cash
    const used = Object.values(p.itcUsed).reduce((a, b) => a + b, 0n);
    const tot = (h: { igst: bigint; cgst: bigint; sgst: bigint; cess: bigint }) => h.igst + h.cgst + h.sgst + h.cess;
    expect(tot(p.payable) + tot(p.rcmCash)).toBe(used + tot(p.cash));
  });
  it("RECONCILIATION: GSTR-1 (from invoices) == GSTR-3B 3.1 (from the ledger), head by head and document by document", () => {
    const r = reconcile(g1, g3, [...outLedger, ...inLedger]);
    expect(r.ok).toBe(true); expect(r.unmatchedDocs).toEqual([]);
    expect(r.checks.every((c) => c.ok && c.diffMinor === 0n)).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual(expect.arrayContaining(["IGST", "CGST", "SGST", "CESS"]));
  });
  it("a ledger row that drifts from its invoice is caught (head check AND per-document list)", () => {
    const bad = outLedger.map((r, k) => (k === 0 ? { ...r, taxMinor: r.taxMinor + 1n } : r));
    const g3b = buildGstr3b(in3([...bad, ...inLedger]));
    const r = reconcile(g1, g3b, bad);
    expect(r.ok).toBe(false); expect(r.unmatchedDocs).toHaveLength(1); expect(r.unmatchedDocs[0]!.ledgerTaxMinor - r.unmatchedDocs[0]!.gstr1TaxMinor).toBe(1n);
    expect(r.checks.filter((c) => !c.ok).length).toBeGreaterThan(0);
  });
  it("a missing output posting is caught", () => {
    const missing = outLedger.filter((r) => r.sourceDocId !== i1.id);
    const r = reconcile(g1, buildGstr3b(in3([...missing, ...inLedger])), missing);
    expect(r.ok).toBe(false); expect(r.unmatchedDocs.map((u) => u.docNo)).toContain("A/1");
  });
  it("interest 18% on the cash liability and the late fee (cap by turnover band) apply only after the due date; a NIL return uses the NIL fee", () => {
    expect(g3.dueDate).toBe("2026-12-20"); expect(dueDateOf("2026-12-31", "quarterly", CFG)).toBe("2027-01-22");
    expect(buildGstr3b(in3([...outLedger, ...inLedger], "2026-12-20")).lateDays).toBe(0);
    const late = buildGstr3b(in3([...outLedger, ...inLedger], "2027-01-19"));          // 30 days late
    expect(late.lateDays).toBe(30);
    const cash = late.payment.cash;
    expect(late.interest.igst).toBe((cash.igst * 1800n * 30n * 2n + 10000n * 365n) / (10000n * 365n * 2n));
    expect(late.lateFeeCgst + late.lateFeeSgst).toBe(150_000n);                         // 30 x Rs 50 = Rs 1,500 < Rs 2,000 cap
    const capped = buildGstr3b(in3([...outLedger, ...inLedger], "2027-06-30"));
    expect(capped.lateFeeCgst + capped.lateFeeSgst).toBe(200_000n);                     // Rs 2,000 cap (turnover <= Rs 1.5 cr)
    const bigTurnover = buildGstr3b(in3([...outLedger, ...inLedger], "2027-12-31", 60_000_000_000n));
    expect(bigTurnover.lateFeeCgst + bigTurnover.lateFeeSgst).toBe(1_000_000n);         // Rs 10,000 cap (> Rs 5 cr)
    const g1nil = buildGstr1(base({}));
    const nil = buildGstr3b({ ...in3([], "2027-06-30"), gstr1: g1nil });
    expect(nil.isNil).toBe(true); expect(nil.lateFeeCgst + nil.lateFeeSgst).toBe(50_000n);
  });
});

describe("pinned JSON adapter (GST3.1)", () => {
  const a = getAdapter("GST3.1");
  const i = inv({ no: "J/1", gstin: "27AAAAA0000A1Z5", pos: "27", date: "2026-11-09", lines: [{ taxable: 123456n, rate: "18" }] });
  const g1 = buildGstr1(base({ invoices: [i, inv({ no: "J/2", pos: "07", lines: [{ taxable: 5_000_000n, rate: "12", hsn: "4901" }] })], issuedInvoiceNos: ["J/1", "J/2"] }));
  const j = a.gstr1(g1) as any;
  it("GSTR-1 carries the documented top-level keys, dd-mm-yyyy dates and rupee decimals", () => {
    for (const k of ["gstin", "fp", "gt", "cur_gt", "version", "hash", "b2b", "b2cl", "b2cs", "cdnr", "cdnur", "exp", "nil", "hsn", "doc_issue", "at", "txpd"]) expect(j, k).toHaveProperty(k);
    expect(j.version).toBe("GST3.1"); expect(j.fp).toBe("112026"); expect(j.gstin).toBe(GSTIN);
    expect(j.b2b[0]).toMatchObject({ ctin: "27AAAAA0000A1Z5" });
    expect(j.b2b[0].inv[0]).toMatchObject({ inum: "J/1", idt: "09-11-2026", pos: "27", rchrg: "N", inv_typ: "R" });
    expect(j.b2b[0].inv[0].itms[0]).toEqual({ num: 1, itm_det: { rt: 18, txval: 1234.56, iamt: 222.22 } });
    expect(j.b2cs[0]).toMatchObject({ sply_ty: "INTER", typ: "OE", pos: "07", rt: 12 });
    expect(j.hsn.data.length).toBe(2); expect(j.hsn.data[0]).toHaveProperty("hsn_sc");
  });
  it("GSTR-3B carries the documented section keys", () => {
    const g3 = buildGstr3b({ cfg: CFG, gstin: GSTIN, ret: "112026", fromDate: "2026-11-01", toDate: "2026-11-30", frequency: "monthly", ledger: [], docMeta: new Map(), gstr1: g1, prevFyTurnoverMinor: 0n, filedOn: null });
    const j3 = a.gstr3b(g3) as any;
    for (const k of ["gstin", "ret_period", "sup_details", "inter_sup", "itc_elg", "inward_sup", "intr_ltfee", "tx_pmt"]) expect(j3, k).toHaveProperty(k);
    for (const k of ["osup_det", "osup_zero", "osup_nil_exmp", "isup_rev", "osup_nongst"]) expect(j3.sup_details, k).toHaveProperty(k);
    expect(j3.itc_elg.itc_avl.map((x: any) => x.ty)).toEqual(["IMPG", "IMPS", "ISRC", "ISD", "OTH"]);
    expect(j3.itc_elg).toHaveProperty("itc_net"); expect(j3.itc_elg.itc_inelg.map((x: any) => x.ty)).toEqual(["RUL", "OTH"]);
    expect(j3.intr_ltfee).toHaveProperty("intr_details"); expect(j3.intr_ltfee).toHaveProperty("ltfee_details");
  });
  it("IFF carries only B2B + CDNR", () => { expect(Object.keys(a.iff(g1)).sort()).toEqual(["b2b", "cdnr", "fp", "gstin", "hash", "version"]); });
  it("bucketsOf pushes the intra-state rounding remainder so buckets sum to the stored heads", () => {
    const odd = inv({ no: "O/1", lines: [{ taxable: 100001n, rate: "18" }, { taxable: 100001n, rate: "5" }] });
    const bs = bucketsOf(odd, false);
    expect(bs.reduce((s, b) => s + b.cgst, 0n)).toBe(odd.cgstMinor); expect(bs.reduce((s, b) => s + b.sgst, 0n)).toBe(odd.sgstMinor);
  });
});
