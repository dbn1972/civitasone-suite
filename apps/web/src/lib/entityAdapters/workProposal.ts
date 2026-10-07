import type { EntityOption } from "@/app/_components/ds";

type ProposalRow = {
  id: string;
  workNumber?: string | null;
  description?: string | null;
  status?: string | null;
};

function toOption(row: ProposalRow): EntityOption {
  const number = (row.workNumber ?? "").trim();
  const desc = (row.description ?? "").trim();
  return {
    id: row.id,
    label: number || desc || row.id,
    sublabel: [number && desc ? desc : null, row.status ? `Status: ${row.status}` : null]
      .filter(Boolean)
      .join(" · ") || undefined,
  };
}

/**
 * EntityPicker adapter for works proposals (GAP-WORKS-APPROVALS-NEW-01 /
 * TS-NEW-01). Wraps the existing GET /v1/works/proposals read (the same
 * endpoint ProposalsTable's loader uses — no new backend route, same
 * role/tenant scoping) in the shared search(q)/resolve(ids) contract so the
 * AA/TS create forms can let an officer pick a work by its number or
 * description instead of hand-copying a UUID. Returns [] on any non-ok
 * response (the picker then shows "No matches" rather than throwing).
 */
async function fetchAll(signal?: AbortSignal): Promise<ProposalRow[]> {
  const res = await fetch("/api/proxy/v1/works/proposals?pageSize=200", { signal });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: ProposalRow[] } | ProposalRow[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

export async function searchWorkProposals(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const rows = await fetchAll(signal);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          (r.workNumber ?? "").toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q),
      )
    : rows;
  return filtered.map(toOption);
}

export async function resolveWorkProposals(ids: string[]): Promise<EntityOption[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await fetchAll();
  return rows.filter((r) => idSet.has(r.id)).map(toOption);
}
