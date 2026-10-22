import type { EntityOption } from "@/app/_components/ds";
import { failStrict, type StrictOpt } from "./strict";

type ProposalRow = {
  id: string;
  workNumber?: string | null;
  description?: string | null;
  status?: string | null;
};

/** A picker option for a work, carrying the proposal status so a form can react to the chosen work. */
export interface WorkProposalOption extends EntityOption {
  status: string | null;
}

/** Proposal status after DAO finalization. */
export const DAO_FINALIZED = "dao_finalized";

/**
 * Proposal statuses from which a technical sanction may be entered. This mirrors the SERVER allow-list
 * (works-service approval/domain.ts canEnterTS: dao_finalized or the downstream ts_eligible); the server stays the
 * authority, this only lets the form say so before the user hits a 422.
 */
export const TS_ELIGIBLE_STATUSES: readonly string[] = [DAO_FINALIZED, "ts_eligible"];

export function isTsEligibleStatus(status: string | null | undefined): boolean {
  return !!status && TS_ELIGIBLE_STATUSES.includes(status);
}

function toOption(row: ProposalRow, opts?: SearchOpts): WorkProposalOption {
  const number = (row.workNumber ?? "").trim();
  const desc = (row.description ?? "").trim();
  const status = row.status ?? null;
  const base: WorkProposalOption = {
    id: row.id,
    label: number || desc || row.id,
    sublabel: [number && desc ? desc : null, status ? `Status: ${status}` : null]
      .filter(Boolean)
      .join(" · ") || undefined,
    status,
  };
  if (opts?.eligibleStatuses && !opts.eligibleStatuses.includes(status ?? "")) {
    return { ...base, disabledReason: opts.ineligibleReason?.(status) ?? "Not available" };
  }
  return base;
}

interface SearchOpts extends StrictOpt {
  /**
   * When given, a work whose status is not in this list is still returned, but as a DISABLED option carrying
   * `ineligibleReason(status)`, so the user sees why it cannot be picked instead of it silently vanishing. Eligible
   * works are also ranked first by the server, so a capped result never hides them behind newer ineligible ones.
   */
  eligibleStatuses?: readonly string[];
  ineligibleReason?: (status: string | null) => string;
}

function rowsOf(body: unknown): ProposalRow[] {
  const rows = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data;
  return Array.isArray(rows) ? (rows as ProposalRow[]) : [];
}

const RESULT_LIMIT = 50;
const IDS_PER_REQUEST = 50;

/**
 * EntityPicker adapter for works proposals (GAP-WORKS-APPROVALS-NEW-01 / TS-NEW-01 / BOQ-NEW-03). The match is done
 * SERVER-side (GET /v1/works/proposals?q=, newest first, tenant-scoped, same role gate as the list) so it no longer
 * depends on the first 200 proposals of the tenant being the right ones. A non-ok response degrades to [] ("No
 * matches") unless the caller opts into `{ strict: true }`, which throws so the picker shows its "could not load" alert.
 */
export async function searchWorkProposals(
  query: string,
  signal: AbortSignal,
  opts?: SearchOpts,
): Promise<WorkProposalOption[]> {
  const params = new URLSearchParams({ q: query.trim(), limit: String(RESULT_LIMIT) });
  if (opts?.eligibleStatuses && opts.eligibleStatuses.length > 0) params.set("prefer", opts.eligibleStatuses.join(","));
  const res = await fetch(`/api/proxy/v1/works/proposals?${params.toString()}`, { signal });
  failStrict(res, opts);
  if (!res.ok) return [];
  return rowsOf(await res.json()).map((row) => toOption(row, opts));
}

/** Resolve already-chosen work ids to their labels (a prefilled `?workId=`, or a saved value). */
export async function resolveWorkProposals(ids: string[], opts?: SearchOpts): Promise<WorkProposalOption[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) chunks.push(unique.slice(i, i + IDS_PER_REQUEST));
  const pages = await Promise.all(
    chunks.map(async (chunk) => {
      const res = await fetch(`/api/proxy/v1/works/proposals?ids=${chunk.map(encodeURIComponent).join(",")}`);
      if (!res.ok) return [] as ProposalRow[];
      return rowsOf(await res.json());
    }),
  );
  return pages.flat().map((row) => toOption(row, opts));
}
