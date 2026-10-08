import type { EntityOption } from "@/app/_components/ds";

/**
 * Client-safe user-directory adapter for EntityPicker
 * (GAP-PROJECTS-DETAIL-MEMBERS-01 / GAP-WORKFLOW-INSTANCES-DETAIL-01).
 *
 * The client counterpart of lib/directory/resolveUsers.ts: it hits the SAME
 * identity-service directory endpoint, but through the browser proxy
 * (`/api/proxy/...`) and with the non-PII {id, displayName} contract, so an
 * interactive picker (e.g. adding a project member) can search people by name
 * and resolve a seeded id's label — without any module exposing email/phone or
 * building a second directory.
 *
 *   • search(q): type-ahead; the endpoint requires ≥2 chars, so a shorter query
 *     short-circuits to [] client-side (no pointless 400). Returns up to 20.
 *   • resolve(ids): batch label lookup for pre-selected ids (EntityPicker seeds
 *     a chip's label from this). Fail-soft: a network/HTTP error yields [], and
 *     EntityPicker then shows the raw id until a name is known.
 *
 * No server-only imports — safe to import from a "use client" component.
 */

type DirectoryRow = { id?: unknown; displayName?: unknown };

function toOptions(payload: unknown): EntityOption[] {
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  const out: EntityOption[] = [];
  for (const raw of rows as DirectoryRow[]) {
    if (!raw || typeof raw.id !== "string") continue;
    if (typeof raw.displayName !== "string" || raw.displayName.length === 0) continue;
    out.push({ id: raw.id, label: raw.displayName });
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_QUERY = 2;
const IDS_PER_REQUEST = 200;

export async function searchDirectoryUsers(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY) return [];
  try {
    const res = await fetch(`/api/proxy/v1/identity/users/directory?q=${encodeURIComponent(q)}`, { signal });
    if (!res.ok) return [];
    return toOptions(await res.json());
  } catch {
    return [];
  }
}

export async function resolveDirectoryUsers(ids: string[]): Promise<EntityOption[]> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && UUID_RE.test(id)))];
  if (unique.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) chunks.push(unique.slice(i, i + IDS_PER_REQUEST));

  const pages = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await fetch(`/api/proxy/v1/identity/users/directory?ids=${chunk.map(encodeURIComponent).join(",")}`);
        if (!res.ok) return [] as EntityOption[];
        return toOptions(await res.json());
      } catch {
        return [] as EntityOption[];
      }
    }),
  );
  return pages.flat();
}
