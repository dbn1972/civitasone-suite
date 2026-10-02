/**
 * Portal list paging decisions (pure, unit-tested).
 */
export const PAGE_SIZE = 20;
// Server caps offset at 10_000; keep (MAX_PAGE - 1) * PAGE_SIZE below it.
export const MAX_PAGE = 500;

export function clampPage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_PAGE) : 1;
}

export type PagedResult =
  | { kind: "ok"; applications: readonly unknown[]; total: number }
  | { kind: "unauthenticated" }
  | { kind: "error" };

/**
 * Where to send the candidate when the requested page is past the end (a stale
 * link or hand-edited ?page): the last page. null = render normally.
 */
export function pageRedirectTarget(result: PagedResult, page: number): string | null {
  if (result.kind !== "ok") return null;
  const pastEnd = result.total > 0 && page > 1 && !result.applications.some(Boolean);
  if (!pastEnd) return null;
  const last = Math.min(Math.max(1, Math.ceil(result.total / PAGE_SIZE)), MAX_PAGE);
  return `/careers/portal?page=${last}`;
}
