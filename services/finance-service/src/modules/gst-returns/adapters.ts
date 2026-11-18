/**
 * MSME commercial M4: versioned JSON adapters. The builders in domain.ts are version-neutral; ONLY an adapter knows a GSTN wire shape.
 * CA-VERIFY: the live portal / offline-tool schema is not publicly published. "GST3.1" below follows the key names recorded in
 * MSME-STATUTORY-CONFIG.md (public sample knowledge, not verified against an official document). To move to another version,
 * add an adapter here and change GSTR_JSON_SCHEMA_VERSION; existing stored runs keep the version they were prepared with.
 */
import type { Bucket, DocOut, Gstr1Model, Gstr3bModel, Heads, NoteOut } from "./domain.js";
import { dmy } from "./domain.js";

export const rs = (p: bigint): number => Number((Number(p) / 100).toFixed(2));
const qty = (q: string): number => Number(q);

export interface GstrAdapter {
  version: string;
  gstr1(m: Gstr1Model): Record<string, unknown>;
  gstr3b(m: Gstr3bModel): Record<string, unknown>;
  iff(m: Gstr1Model): Record<string, unknown>;
}

const heads = (h: Heads, only?: Array<keyof Heads>): Record<string, number> => {
  const o: Record<string, number> = {};
  const want = (k: keyof Heads): boolean => (only ? only.includes(k) : true);
  if (want("igst")) o.iamt = rs(h.igst);
  if (want("cgst")) o.camt = rs(h.cgst);
  if (want("sgst")) o.samt = rs(h.sgst);
  if (want("cess")) o.csamt = rs(h.cess);
  return o;
};
/** Only the heads that apply to the supply: IGST inter-state, CGST+SGST intra-state, cess when present. */
const itemHeads = (b: Heads): Record<string, number> => ({
  ...(b.igst !== 0n ? { iamt: rs(b.igst) } : {}),
  ...(b.cgst !== 0n || b.sgst !== 0n ? { camt: rs(b.cgst), samt: rs(b.sgst) } : {}),
  ...(b.cess !== 0n ? { csamt: rs(b.cess) } : {}),
});
const items = (bs: Bucket[]): unknown[] => bs.map((b, k) => ({ num: k + 1, itm_det: { rt: Number(b.rate), txval: rs(b.taxable), ...itemHeads(b) } }));
const invOut = (d: DocOut, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ inum: d.num, idt: dmy(d.date), val: rs(d.val), pos: d.pos, rchrg: d.rchrg ? "Y" : "N", inv_typ: "R", ...extra, itms: items(d.items) });
const ntOut = (n: NoteOut): Record<string, unknown> =>
  ({ ntty: n.type, nt_num: n.num, nt_dt: dmy(n.date), val: rs(n.val), pos: n.pos, rchrg: "N", inv_typ: "R", itms: items(n.items) });
const adv = (rows: Gstr1Model["at"]): unknown[] => {
  const byPos = new Map<string, Gstr1Model["at"]>();
  for (const r of rows) (byPos.get(`${r.pos}|${r.splyTy}`) ?? byPos.set(`${r.pos}|${r.splyTy}`, []).get(`${r.pos}|${r.splyTy}`)!).push(r);
  return [...byPos.entries()].map(([k, rs_]) => ({ pos: k.split("|")[0], sply_ty: rs_[0]!.splyTy, itms: rs_.map((r) => ({ rt: Number(r.rate), ad_amt: rs(r.adAmt), ...itemHeads(r) })) }));
};
const fp = (period: string): string => `${period.slice(4)}${period.slice(0, 4)}`;

const GST31: GstrAdapter = {
  version: "GST3.1",
  gstr1(m) {
    const out: Record<string, unknown> = {
      gstin: m.gstin, fp: m.fp, gt: rs(m.grossTurnoverPrevFyMinor), cur_gt: rs(m.grossTurnoverCurFyMinor), version: "GST3.1", hash: "hash",
      b2b: m.b2b.map((c) => ({ ctin: c.ctin, inv: c.inv.map((d) => invOut(d)) })),
      b2cl: m.b2cl.map((c) => ({ pos: c.pos, inv: c.inv.map((d) => ({ inum: d.num, idt: dmy(d.date), val: rs(d.val), itms: items(d.items) })) })),
      b2cs: m.b2cs.map((r) => ({ sply_ty: r.splyTy, rt: Number(r.rate), typ: "OE", pos: r.pos, txval: rs(r.taxable), ...itemHeads(r) })),
      cdnr: m.cdnr.map((c) => ({ ctin: c.ctin, nt: c.nt.map(ntOut) })),
      cdnur: m.cdnur.map((n) => ({ typ: n.exportKind ?? "B2CL", ntty: n.type, nt_num: n.num, nt_dt: dmy(n.date), val: rs(n.val), pos: n.pos, itms: items(n.items) })),
      exp: m.exp.map((e) => ({ exp_typ: e.type, inv: e.inv.map((d) => ({ inum: d.num, idt: dmy(d.date), val: rs(d.val), itms: d.items.map((b) => ({ txval: rs(b.taxable), rt: Number(b.rate), ...(b.igst !== 0n ? { iamt: rs(b.igst) } : {}), ...(b.cess !== 0n ? { csamt: rs(b.cess) } : {}) })) })) })),
      nil: { inv: m.nil.map((n) => ({ sply_ty: n.splyTy, expt_amt: 0, nil_amt: rs(n.nilAmt), ngsup_amt: 0 })) },
      hsn: { data: m.hsn.map((h, k) => ({ num: k + 1, hsn_sc: h.hsn, desc: h.desc, uqc: h.uqc, qty: qty(h.qty), val: rs(h.val), txval: rs(h.taxable), rt: Number(h.rate), ...heads(h) })) },
      doc_issue: { doc_det: [
        ...(["Invoices for outward supply", "Debit Note", "Credit Note"] as const).map((nature, k) => ({ doc_num: [1, 4, 5][k], doc_typ: nature, docs: m.docIssue.filter((d) => d.nature === nature).map((d, j) => ({ num: j + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.net })) })).filter((x) => x.docs.length > 0),
      ] },
      at: adv(m.at), txpd: adv(m.txpd),
      b2ba: m.b2ba.map((c) => ({ ctin: c.ctin, inv: c.inv.map((d) => invOut(d, { oinum: d.origNum, oidt: dmy(d.origDate) })) })),
      cdnra: m.cdnra.map((c) => ({ ctin: c.ctin, nt: c.nt.map((n) => ({ ...ntOut(n), ont_num: n.origNum, ont_dt: dmy(n.origDate) })) })),
    };
    return out;
  },
  iff(m) {
    return { gstin: m.gstin, fp: m.fp, version: "GST3.1", hash: "hash", b2b: m.b2b.map((c) => ({ ctin: c.ctin, inv: c.inv.map((d) => invOut(d)) })), cdnr: m.cdnr.map((c) => ({ ctin: c.ctin, nt: c.nt.map(ntOut) })) };
  },
  gstr3b(m) {
    const itc = (ty: string, h: Heads): Record<string, unknown> => ({ ty, ...heads(h) });
    const z = { igst: 0n, cgst: 0n, sgst: 0n, cess: 0n };
    return {
      gstin: m.gstin, ret_period: m.ret, version: "GST3.1", hash: "hash",
      sup_details: {
        osup_det: { txval: rs(m.osupDet.taxable), ...heads(m.osupDet.heads) },
        osup_zero: { txval: rs(m.osupZero.taxable), iamt: rs(m.osupZero.heads.igst), csamt: rs(m.osupZero.heads.cess) },
        osup_nil_exmp: { txval: rs(m.osupNilExmp) },
        isup_rev: { txval: rs(m.isupRev.taxable), ...heads(m.isupRev.heads) },
        osup_nongst: { txval: rs(m.osupNongst) },
      },
      inter_sup: { unreg_details: m.unreg.map((u) => ({ pos: u.pos, txval: rs(u.taxable), iamt: rs(u.igst) })), comp_details: [], uin_details: [] },
      itc_elg: {
        itc_avl: [itc("IMPG", z), itc("IMPS", z), itc("ISRC", m.itcAvl.isrc), itc("ISD", z), itc("OTH", m.itcAvl.oth)],
        itc_rev: [itc("RUL", m.itcRev), itc("OTH", z)],
        itc_net: heads(m.itcNet),
        itc_inelg: [itc("RUL", z), itc("OTH", m.itcInelg)],
      },
      inward_sup: { isup_details: [{ ty: "GST", inter: rs(m.inwardExempt.inter), intra: rs(m.inwardExempt.intra) }, { ty: "NONGST", inter: 0, intra: 0 }] },
      intr_ltfee: { intr_details: heads(m.interest), ltfee_details: { camt: rs(m.lateFeeCgst), samt: rs(m.lateFeeSgst) } },
      // CA-VERIFY: Table 6 (payment) is computed at payment time on the portal and has no stable save-payload key; carried as an extension.
      tx_pmt: {
        tax_payable: heads(m.payment.payable), rcm_cash: heads(m.payment.rcmCash), cash: heads(m.payment.cash), itc_carry_forward: heads(m.payment.itcCarryForward),
        itc_utilised: Object.fromEntries(Object.entries(m.payment.itcUsed).map(([k, v]) => [k, rs(v)])),
      },
    };
  },
};

const REGISTRY = new Map<string, GstrAdapter>([[GST31.version, GST31]]);
export function getAdapter(version: string): GstrAdapter {
  const a = REGISTRY.get(version);
  if (!a) throw new Error(`GSTR_JSON_VERSION_UNSUPPORTED: no adapter for JSON schema version '${version}' (supported: ${[...REGISTRY.keys()].join(", ")})`);
  return a;
}
export const supportedVersions = (): string[] => [...REGISTRY.keys()];
export { fp as retPeriod };
