import type { AccountSummary } from "@civitasone/types";

/**
 * Account-head lookup for ledger / statement screens (UAT Phase 1B, recon D11/D13).
 *
 * finance-service's ledger feeds identify a head inconsistently: the statements
 * feed sends the head's UUID as `head`, and journal lines carry either the head
 * code ("1100") or, for some postings, the head UUID -- with `accountName`
 * simply repeating that code. This resolves either identifier against the chart
 * of accounts (GET /v1/finance/accounts) so the screen shows "code · name"
 * instead of a UUID or a repeated code.
 *
 * Plain serialisable data (a Record), so a Server Component can hand it to a
 * client table as a prop.
 */
export type HeadRef = { code: string; name: string };
export type HeadLookup = Record<string, HeadRef>;

export function buildHeadLookup(accounts: ReadonlyArray<Pick<AccountSummary, "code" | "name" | "id">>): HeadLookup {
  const out: HeadLookup = {};
  for (const a of accounts) {
    if (!a.code || !a.name) continue;
    const ref = { code: a.code, name: a.name };
    out[a.code] = ref;
    if (a.id) out[a.id] = ref;
  }
  return out;
}

/** The head for a code or UUID, or null when the chart does not know it. */
export function resolveHead(lookup: HeadLookup, idOrCode: string | null | undefined): HeadRef | null {
  if (!idOrCode) return null;
  return Object.prototype.hasOwnProperty.call(lookup, idOrCode) ? lookup[idOrCode]! : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "1100 · Bank" for a known head. An unknown code is shown as-is (it is a real,
 * human code); an unknown UUID is never shown raw -- it reads "Unknown head".
 */
export function headLabel(lookup: HeadLookup, idOrCode: string | null | undefined): string {
  const ref = resolveHead(lookup, idOrCode);
  if (ref) return `${ref.code} · ${ref.name}`;
  if (!idOrCode) return "—";
  return UUID_RE.test(idOrCode) ? "Unknown head" : idOrCode;
}
