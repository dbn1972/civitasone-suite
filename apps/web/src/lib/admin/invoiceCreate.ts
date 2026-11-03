/**
 * UAT P2 (J8): pure rules for the New invoice form (/admin/invoices/new). They mirror billing-service's
 * createInvoiceBody / validateGstSplit (services/billing-service/src/modules/invoices/validators.ts, domain.ts) so
 * the officer is told what is wrong before anything is sent; the service stays the authority.
 * Money: rupees typed on screen -> integer paise via the string-based rupeesToMinorString (never a float). The
 * service takes paise as a JSON integer, so an amount above Number.MAX_SAFE_INTEGER paise is refused here.
 */
import { rupeesToMinorString } from "@/lib/money";

export type InvoiceItemKind = "line" | "tax" | "charge";
export const INVOICE_ITEM_KINDS: readonly InvoiceItemKind[] = ["line", "tax", "charge"];

export type InvoiceItemForm = { description: string; kind: InvoiceItemKind; hsnSac: string; quantity: string; amount: string };
export type InvoiceGstForm = { supplierGstin: string; recipientGstin: string; placeOfSupply: string; cgst: string; sgst: string; igst: string };
export type InvoiceForm = { periodMonth: string; items: InvoiceItemForm[]; gstEnabled: boolean; gst: InvoiceGstForm };

/** Message keys (adminInvoiceNew.*) per field; `items.<i>.<field>` and `gst.<field>` for nested fields. */
export type InvoiceFormErrors = Record<string, string>;

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const HSN_SAC_RE = /^(\d{4}|\d{6}|\d{8})$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const emptyItem = (): InvoiceItemForm => ({ description: "", kind: "line", hsnSac: "", quantity: "1", amount: "" });
export const emptyGst = (): InvoiceGstForm => ({ supplierGstin: "", recipientGstin: "", placeOfSupply: "", cgst: "0", sgst: "0", igst: "0" });

function paise(v: string, allowZero: boolean): bigint | null {
  const s = rupeesToMinorString(v, { allowZero });
  if (s === null) return null;
  const b = BigInt(s);
  return b > BigInt(Number.MAX_SAFE_INTEGER) ? null : b;
}

/** Totals in paise of the items as typed (invalid rows count as 0). */
export function invoiceTotals(items: readonly InvoiceItemForm[]): { taxMinor: bigint; totalMinor: bigint } {
  let tax = 0n;
  let total = 0n;
  for (const it of items) {
    const amt = paise(it.amount, true) ?? 0n;
    const qty = /^\d{1,6}$/.test(it.quantity.trim()) ? BigInt(it.quantity.trim()) : 0n;
    const v = amt * qty;
    total += v;
    if (it.kind === "tax") tax += v;
  }
  return { taxMinor: tax, totalMinor: total };
}

export function validateInvoiceForm(f: InvoiceForm): InvoiceFormErrors {
  const e: InvoiceFormErrors = {};
  if (!PERIOD_RE.test(f.periodMonth.trim())) e.periodMonth = "periodInvalid";
  if (f.items.length === 0) e.items = "itemsRequired";
  f.items.forEach((it, i) => {
    const d = it.description.trim();
    if (d.length === 0 || d.length > 500) e[`items.${i}.description`] = "descriptionRequired";
    if (!/^\d{1,6}$/.test(it.quantity.trim()) || Number(it.quantity.trim()) < 1) e[`items.${i}.quantity`] = "quantityInvalid";
    if (paise(it.amount, true) === null) e[`items.${i}.amount`] = "amountInvalid";
    if (it.hsnSac.trim() !== "" && !HSN_SAC_RE.test(it.hsnSac.trim())) e[`items.${i}.hsnSac`] = "hsnInvalid";
  });
  if (f.items.length > 0 && Object.keys(e).every((k) => !k.startsWith("items.")) && invoiceTotals(f.items).totalMinor <= 0n) {
    e.items = "totalZero";
  }
  if (f.gstEnabled) {
    const g = f.gst;
    const sup = g.supplierGstin.trim().toUpperCase();
    const rec = g.recipientGstin.trim().toUpperCase();
    if (!GSTIN_RE.test(sup)) e["gst.supplierGstin"] = "gstinInvalid";
    if (!GSTIN_RE.test(rec)) e["gst.recipientGstin"] = "gstinInvalid";
    if (!/^[0-9]{2}$/.test(g.placeOfSupply.trim())) e["gst.placeOfSupply"] = "placeInvalid";
    const c = paise(g.cgst, true);
    const s = paise(g.sgst, true);
    const ig = paise(g.igst, true);
    if (c === null) e["gst.cgst"] = "amountInvalid";
    if (s === null) e["gst.sgst"] = "amountInvalid";
    if (ig === null) e["gst.igst"] = "amountInvalid";
    if (c !== null && s !== null && ig !== null && !e["gst.supplierGstin"] && !e["gst.placeOfSupply"]) {
      if (c + s + ig !== invoiceTotals(f.items).taxMinor) e.gst = "gstSumMismatch";
      else if (sup.slice(0, 2) === g.placeOfSupply.trim()) {
        if (ig !== 0n) e.gst = "gstIntraIgst";
        else if (c !== s) e.gst = "gstIntraEqual";
      } else if (c !== 0n || s !== 0n) e.gst = "gstInterOnlyIgst";
    }
  }
  return e;
}

/** POST /v1/billing/invoices body. Call only after validateInvoiceForm returned no errors. */
export function buildInvoiceBody(tenantId: string, f: InvoiceForm) {
  const p = (v: string) => Number(paise(v, true) ?? 0n);
  return {
    tenantId,
    periodMonth: f.periodMonth.trim(),
    items: f.items.map((it) => ({
      description: it.description.trim(),
      kind: it.kind,
      quantity: Number(it.quantity.trim()),
      amountMinor: p(it.amount),
      ...(it.hsnSac.trim() ? { hsnSac: it.hsnSac.trim() } : {}),
    })),
    ...(f.gstEnabled
      ? {
          gst: {
            supplierGstin: f.gst.supplierGstin.trim().toUpperCase(),
            recipientGstin: f.gst.recipientGstin.trim().toUpperCase(),
            placeOfSupply: f.gst.placeOfSupply.trim(),
            cgstMinor: p(f.gst.cgst),
            sgstMinor: p(f.gst.sgst),
            igstMinor: p(f.gst.igst),
          },
        }
      : {}),
  };
}
