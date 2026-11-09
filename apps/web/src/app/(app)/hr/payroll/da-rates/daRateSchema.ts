import { percentToBps } from "@/lib/money";

export type DaRateFormField = "effectiveFrom" | "ratePct" | "orderRef";
export type DaRatePayload = { effectiveFrom: string; rateBps: number; orderRef: string };

export function parseDaRateForm(input: { effectiveFrom: string; ratePct: string; orderRef: string }):
  | { ok: true; payload: DaRatePayload }
  | { ok: false; field: DaRateFormField; messageKey: "errEffectiveFrom" | "errRate" | "errOrderRef" } {
  const effectiveFrom = input.effectiveFrom.trim();
  // DA is revised from the 1st of a month (January / July orders); payroll resolves it per month.
  if (!/^\d{4}-\d{2}-01$/.test(effectiveFrom) || Number.isNaN(Date.parse(effectiveFrom))) {
    return { ok: false, field: "effectiveFrom", messageKey: "errEffectiveFrom" };
  }
  const rateBps = percentToBps(input.ratePct);
  if (rateBps === null || rateBps < 0 || rateBps > 20000) return { ok: false, field: "ratePct", messageKey: "errRate" };
  const orderRef = input.orderRef.trim();
  if (orderRef.length < 10 || orderRef.length > 300) return { ok: false, field: "orderRef", messageKey: "errOrderRef" };
  return { ok: true, payload: { effectiveFrom, rateBps, orderRef } };
}
