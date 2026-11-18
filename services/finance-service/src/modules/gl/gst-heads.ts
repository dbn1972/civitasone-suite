/**
 * MSME M3a: the per-tax GST heads of the COMMERCIAL chart. A single "GST Input Credit" head (1700, M1) is too coarse for the GST
 * return (GSTR-3B 4A is IGST / CGST / SGST / Cess, and set-off is tax-specific), so each tax has its own asset head, plus an
 * RCM-pending asset head (ITC on reverse-charge tax is claimable only after the tax is PAID) and the RCM payable liability.
 *
 * ONE definition: standard-heads.ts seeds exactly these (commercial template only -- no govt/nonprofit chart gets them),
 * commercial-chart.ts requires them (fail-closed by classification), and the GST posting/consumer path posts to them. Codes avoid every
 * core, nonprofit and grant code. Fixed codes (not env-overridable): the reconciliation and the claim journal both key on them.
 */

export type GstHeadDef = { code: string; name: string; classification: "asset" | "liability"; statementClass: "asset" | "current_liability" };

export const GST_ITC_HEAD_CODE = { IGST: "1701", CGST: "1702", SGST: "1703", CESS: "1704" } as const;
/** ITC on reverse-charge tax, held here until the RCM tax is paid, then moved to the per-tax ITC head (finance.gst.rcm_itc_claim). */
export const RCM_ITC_PENDING_CODE = "1705";
/** The recipient's reverse-charge liability (kept apart from 2300 GST Payable on outward supplies). */
export const RCM_PAYABLE_CODE = "2301";

export type GstTaxType = keyof typeof GST_ITC_HEAD_CODE;

export const GST_HEADS: readonly GstHeadDef[] = [
  { code: GST_ITC_HEAD_CODE.IGST, name: "GST Input Credit - IGST", classification: "asset", statementClass: "asset" },
  { code: GST_ITC_HEAD_CODE.CGST, name: "GST Input Credit - CGST", classification: "asset", statementClass: "asset" },
  { code: GST_ITC_HEAD_CODE.SGST, name: "GST Input Credit - SGST/UTGST", classification: "asset", statementClass: "asset" },
  { code: GST_ITC_HEAD_CODE.CESS, name: "GST Input Credit - Cess", classification: "asset", statementClass: "asset" },
  { code: RCM_ITC_PENDING_CODE, name: "GST Input Credit - Reverse Charge (awaiting payment)", classification: "asset", statementClass: "asset" },
  { code: RCM_PAYABLE_CODE, name: "GST Payable - Reverse Charge", classification: "liability", statementClass: "current_liability" },
];
