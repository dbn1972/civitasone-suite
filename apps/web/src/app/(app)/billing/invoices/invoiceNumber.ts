/**
 * The invoice's display number: the GST invoice number billing-service stores
 * and returns as `invoiceNumber` (e.g. "INV-2627-000009", minted gaplessly when
 * the invoice is issued). A draft has none yet (null) and reads "Draft (not
 * numbered)" -- never a number made up on the screen.
 *
 * UAT Phase 1B (recon D18): the list used to synthesise "INV-<period>-<uuid8>"
 * and the detail title "Invoice <uuid8>", which looked like, but never was, the
 * statutory invoice number.
 */
export const DRAFT_INVOICE_LABEL = "Draft (not numbered)";

export function invoiceDisplayNumber(row: { invoiceNumber?: unknown }): string {
  const n = typeof row.invoiceNumber === "string" ? row.invoiceNumber.trim() : "";
  return n || DRAFT_INVOICE_LABEL;
}
