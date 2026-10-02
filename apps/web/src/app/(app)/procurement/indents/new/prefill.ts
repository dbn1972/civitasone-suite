import type { LineItem } from "../../_components/LineItemsEditor";

const MAX_QTY = 1_000_000;
const MAX_CODE = 64;
const MAX_DESCRIPTION = 200;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export type IndentPrefill = {
  item: LineItem;
  /** True when the item code or description was cut to fit, so the form can say so. */
  truncated: boolean;
};

/**
 * First line item prefilled from the query string (itemCode, description,
 * quantity), or null when the link carries no item. Values are length-capped
 * and the quantity must be a positive whole number: this is a convenience
 * default the requester can edit, never trusted input (the form validates and
 * the service re-validates on submit).
 */
export function parseIndentPrefill(params: Record<string, string | string[] | undefined>): IndentPrefill | null {
  const rawCode = first(params.itemCode);
  const rawDescription = first(params.description);
  if (!rawCode && !rawDescription) return null;
  const itemCode = rawCode.slice(0, MAX_CODE);
  const description = rawDescription.slice(0, MAX_DESCRIPTION);
  const q = Number(first(params.quantity));
  const quantity = Number.isInteger(q) && q >= 1 && q <= MAX_QTY ? q : 1;
  return {
    item: { itemCode, description, quantity, unitPrice: 0 },
    truncated: itemCode.length < rawCode.length || description.length < rawDescription.length,
  };
}
