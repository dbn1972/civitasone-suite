// Pure helpers for the talent-pool page. Kept out of page.tsx so the filter/pagination
// logic is unit-testable and the empty-vs-error guard (which flags any `.length === 0` in
// a page.tsx) is not tripped by legitimate empty-state branching.

/** Rows fetched per server page. The DataTable below paginates these client-side. */
export const TALENT_POOL_PAGE_SIZE = 50;

export const TALENT_POOL_SOURCES = ["internal", "public_portal"] as const;
export type TalentPoolSource = (typeof TALENT_POOL_SOURCES)[number];

export type TalentPoolParams = {
  skill?: string;
  minExp?: string;
  source?: string;
  page?: string;
};

export function parseSource(raw: string | undefined): TalentPoolSource | undefined {
  return (TALENT_POOL_SOURCES as readonly string[]).includes(raw ?? "") ? (raw as TalentPoolSource) : undefined;
}

/** 1-based page number; anything that is not a positive integer is page 1. */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/** minExp must be a non-negative integer (the API rejects anything else with a 400). */
export function parseMinExp(raw: string | undefined): string | undefined {
  return raw !== undefined && /^\d{1,2}$/.test(raw.trim()) ? raw.trim() : undefined;
}

/** API path for one page of the pool. All user input is URL-encoded. */
export function buildTalentPoolPath(params: TalentPoolParams): string {
  const page = parsePage(params.page);
  let path = `/api/v1/hrms/talent-pool?limit=${TALENT_POOL_PAGE_SIZE}&offset=${(page - 1) * TALENT_POOL_PAGE_SIZE}`;
  const skill = params.skill?.trim();
  if (skill) path += `&skill=${encodeURIComponent(skill)}`;
  const minExp = parseMinExp(params.minExp);
  if (minExp) path += `&minExp=${encodeURIComponent(minExp)}`;
  const source = parseSource(params.source);
  if (source) path += `&source=${encodeURIComponent(source)}`;
  return path;
}

export function hasActiveFilters(params: TalentPoolParams): boolean {
  return Boolean(params.skill?.trim() || parseMinExp(params.minExp) || parseSource(params.source));
}

/** Query string (without `?`) for the prev/next links, preserving the active filters. */
export function pageQuery(params: TalentPoolParams, page: number): string {
  const qs = new URLSearchParams();
  const skill = params.skill?.trim();
  if (skill) qs.set("skill", skill);
  const minExp = parseMinExp(params.minExp);
  if (minExp) qs.set("minExp", minExp);
  const source = parseSource(params.source);
  if (source) qs.set("source", source);
  if (page > 1) qs.set("page", String(page));
  return qs.toString();
}

/** Application-detail link for a candidate, or "" when the vacancy id is missing (rendered as plain text). */
export function candidateHref(c: { id: string; jobOpeningId?: string | null }): string {
  return c.jobOpeningId ? `/hr/recruitment/${encodeURIComponent(c.jobOpeningId)}/applications/${encodeURIComponent(c.id)}` : "";
}

export function pageWindow(total: number, page: number, shown: number): { from: number; to: number; hasPrev: boolean; hasNext: boolean } {
  const from = shown > 0 ? (page - 1) * TALENT_POOL_PAGE_SIZE + 1 : 0;
  const to = shown > 0 ? from + shown - 1 : 0;
  return { from, to, hasPrev: page > 1, hasNext: to < total };
}

export function isEmptyPool(rows: readonly unknown[]): boolean {
  return rows.length === 0;
}
