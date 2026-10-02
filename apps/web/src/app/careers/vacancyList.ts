/**
 * Pure list helpers for the public careers home (type filter, search, sort,
 * paging, href building). Kept out of page.tsx so they are unit-testable.
 */
export type ListVacancy = {
  id: string;
  title: string;
  refNo?: string;
  vacancyType: string;
  location?: string;
  qualification?: string;
  closesAt?: string;
};

export const PAGE_SIZE = 20;

export function matchesQuery(v: ListVacancy, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [v.title, v.refNo, v.location, v.qualification].some((f) => (f ?? "").toLowerCase().includes(needle));
}

/** Closing soonest first; vacancies without a deadline last. Stable for ties. */
export function sortByClosing<T extends ListVacancy>(list: readonly T[]): T[] {
  return list
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const ta = a.v.closesAt ? Date.parse(a.v.closesAt) : Number.POSITIVE_INFINITY;
      const tb = b.v.closesAt ? Date.parse(b.v.closesAt) : Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.v);
}

export function parsePage(raw: string | undefined, pageCount: number): number {
  const n = Number.parseInt(raw ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(pageCount, 1));
}

export function careersHref(params: { type?: string; q?: string; page?: number }): string {
  const sp = new URLSearchParams();
  if (params.type) sp.set("type", params.type);
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/careers?${qs}` : "/careers";
}
