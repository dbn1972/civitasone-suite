/** Normalise a status/stage string the way ds/StatusPill does (snake/kebab/camel -> spaced lowercase). */
export function normStatus(v: unknown): string {
  return String(v ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** A money field that must stay exactly as the API sent it (paise as string/number) or be absent. */
export function moneyField(v: unknown): string | number | null {
  return typeof v === "string" || typeof v === "number" ? v : null;
}
