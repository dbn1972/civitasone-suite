import { fetchJson } from "@/app/_data/apiClient";

/**
 * Shared server-side user-directory resolver
 * (GAP-WORKFLOW-INSTANCES-DETAIL-01 / GAP-PROJECTS-DETAIL-MEMBERS-01).
 *
 * Many pages carry only opaque user ids (a workflow transition's actorId, a
 * project member's userId, …) and need to show a human name without any one
 * module building its own name-join. This is the single shared helper the
 * FIXER-RULES 'high24 specifics' mandates: every module imports THIS, none
 * builds a second one.
 *
 * It calls identity-service's non-PII directory endpoint
 * (`GET /v1/identity/users/directory?ids=…`, {id, displayName} only), which is
 * open to any authenticated member of the caller's OWN tenant and strictly
 * tenant-scoped server-side — so this helper can never resolve a name outside
 * the signed-in user's tenant.
 *
 * Properties:
 *   • Batched — one request per 200 ids (the endpoint's cap), never per row.
 *   • Cached per request — the underlying `fetch` goes through
 *     `@/app/_data/apiClient` with `revalidateSeconds`, so Next's fetch
 *     memoization dedupes identical directory calls within a single server
 *     render (e.g. a history timeline AND a task table on the same page
 *     requesting overlapping id sets) to one network round-trip, and caches
 *     across renders for the revalidate window. Mirrors the sibling
 *     `_data/employeeNames.ts` resolver's caching model.
 *   • Fail-soft — an id the directory doesn't return (deleted, cross-tenant, or
 *     the lookup failed) is simply ABSENT from the map; callers fall back to a
 *     short id via `userDisplayLabel`. It NEVER throws and never invents a name.
 *
 * Server-only: imports `@/app/_data/apiClient` (next/headers). Do not import
 * from a "use client" component — use the client-safe search proxy instead
 * (lib/directory/searchUsers.ts) for interactive pickers.
 */

const IDS_PER_REQUEST = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DirectoryEntry = { id: string; displayName: string };

type DirectoryRow = { id?: unknown; displayName?: unknown };

function toEntries(payload: unknown): Array<[string, string]> | null {
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return null;
  const out: Array<[string, string]> = [];
  for (const raw of rows as DirectoryRow[]) {
    if (!raw || typeof raw.id !== "string") continue;
    if (typeof raw.displayName !== "string" || raw.displayName.length === 0) continue;
    out.push([raw.id, raw.displayName]);
  }
  return out;
}

/**
 * Resolve a set of user ids to display names, tenant-scoped. Returns a Map
 * keyed by id; ids with no resolvable name are omitted (fail-soft). Identical
 * directory requests within one render are deduped by Next's fetch cache.
 */
export async function resolveUsers(ids: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id) => typeof id === "string" && UUID_RE.test(id)))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) chunks.push(unique.slice(i, i + IDS_PER_REQUEST));

  const pages = await Promise.all(
    chunks.map((chunk) =>
      fetchJson<unknown, Array<[string, string]>>(
        `/v1/identity/users/directory?ids=${chunk.map(encodeURIComponent).join(",")}`,
        [],
        { telemetryKey: "identity.users.directory", revalidateSeconds: 30, mapResponse: toEntries },
      ),
    ),
  );
  for (const page of pages) {
    if (!Array.isArray(page.data)) continue;
    for (const [id, name] of page.data) if (typeof id === "string" && typeof name === "string") result.set(id, name);
  }
  return result;
}

/**
 * The display label for a user id against a resolved map: the name when known,
 * otherwise an honest short id ("1a2b3c4d…") — never a guessed or fabricated
 * name. An empty/absent id renders the supplied em-dash fallback.
 */
export function userDisplayLabel(
  names: Map<string, string>,
  id: string | null | undefined,
  emptyFallback = "—",
): string {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return emptyFallback;
  const name = names.get(trimmed);
  if (name) return name;
  return `${trimmed.slice(0, 8)}…`;
}
