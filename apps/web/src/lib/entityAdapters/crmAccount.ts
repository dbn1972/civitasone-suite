import type { EntityOption } from "@/app/_components/ds";
import { failStrict, type StrictOpt } from "./strict";

type AccountRow = {
  id?: string;
  name?: string | null;
  industry?: string | null;
};

/** How many matches the picker asks the server for (a picker, not a list view). */
const SEARCH_LIMIT = 10;

function toOption(row: AccountRow): EntityOption | null {
  const name = (row.name ?? "").trim();
  // An account without a name is never labelled with its id (a raw UUID).
  if (!row.id || !name) return null;
  const industry = (row.industry ?? "").trim();
  return { id: row.id, label: name, ...(industry ? { sublabel: industry } : {}) };
}

function rowsOf(body: unknown): AccountRow[] {
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as AccountRow[]) : [];
}

export interface CrmAccountSearchOpts extends StrictOpt {
  /**
   * Hide this account AND every descendant of it, server-side. A re-parent picker
   * must not offer a target that would close a hierarchy loop; the server applies
   * the exclusion to the whole subtree, however large the account list is.
   */
  excludeSubtreeOf?: string;
  /** Hide specific ids (e.g. the account itself in a "related account" picker). */
  excludeIds?: readonly string[];
}

/**
 * EntityPicker adapters for CRM accounts (GAP-CRM-ACCOUNTS-DETAIL-01).
 *
 * Asks crm-service for the matches (`GET /v1/crm/accounts?search=`), so a picker
 * works for a tenant with more accounts than the capped list endpoint returns --
 * the previous pickers were filled from that one capped page and silently
 * omitted every account beyond it. Returns [] on a non-ok response unless
 * `{ strict: true }` (then the picker shows its distinct "could not load" alert).
 */
export async function searchCrmAccounts(
  query: string,
  signal: AbortSignal,
  opts?: CrmAccountSearchOpts,
): Promise<EntityOption[]> {
  const params = new URLSearchParams({ limit: String(SEARCH_LIMIT) });
  const q = query.trim();
  if (q) params.set("search", q);
  if (opts?.excludeSubtreeOf) params.set("excludeSubtreeOf", opts.excludeSubtreeOf);
  const res = await fetch(`/api/proxy/v1/crm/accounts?${params.toString()}`, { signal });
  failStrict(res, opts);
  if (!res.ok) return [];
  const hidden = new Set(opts?.excludeIds ?? []);
  return rowsOf(await res.json())
    .filter((r) => !(r.id && hidden.has(r.id)))
    .map(toOption)
    .filter((o): o is EntityOption => o !== null);
}

/** Resolve ids to labelled options through the by-id endpoint (ids it cannot find are omitted). */
export async function resolveCrmAccounts(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const found = await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(`/api/proxy/v1/crm/accounts/${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        const body = (await res.json()) as { data?: AccountRow };
        return body.data ? toOption(body.data) : null;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((o): o is EntityOption => o !== null);
}
