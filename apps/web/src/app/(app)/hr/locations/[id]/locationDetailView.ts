/**
 * Pure view helpers for /hr/locations/[id] (GAP-HR-LOCATIONS-03). Kept out of
 * page.tsx so the empty-vs-error decision and URL/paging maths are unit
 * tested and the page itself has no count checks.
 */

export const PAGE_SIZE = 25;

export const STATUS_OPTIONS = [
  "active", "all", "probation", "confirmed", "on_leave", "suspended", "deputation", "no_show", "retired", "separated", "terminated",
] as const;
export type StatusOption = (typeof STATUS_OPTIONS)[number];

export type DetailParams = {
  page: number;
  q: string;
  includeSub: boolean;
  status: StatusOption;
};

export function parseDetailParams(sp: Record<string, string | string[] | undefined> | undefined): DetailParams {
  const one = (k: string): string => {
    const v = sp?.[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const rawStatus = one("status");
  return {
    page: Math.max(0, parseInt(one("page"), 10) || 0),
    q: one("q").trim().slice(0, 100),
    includeSub: one("sub") === "1",
    status: (STATUS_OPTIONS as readonly string[]).includes(rawStatus) ? (rawStatus as StatusOption) : "active",
  };
}

export function detailHref(locationId: string, p: Partial<DetailParams>): string {
  const qs: string[] = [];
  if (p.includeSub) qs.push("sub=1");
  if (p.status && p.status !== "active") qs.push("status=" + encodeURIComponent(p.status));
  if (p.q) qs.push("q=" + encodeURIComponent(p.q));
  if (p.page && p.page > 0) qs.push("page=" + p.page);
  return `/hr/locations/${locationId}` + (qs.length ? "?" + qs.join("&") : "");
}

/** The employees-API query string for a page of the roster. */
export function employeesQuery(p: DetailParams): string {
  const qs = [`limit=${PAGE_SIZE}`, `offset=${p.page * PAGE_SIZE}`, `status=${encodeURIComponent(p.status)}`];
  if (p.includeSub) qs.push("includeSubLocations=true");
  if (p.q) qs.push("q=" + encodeURIComponent(p.q));
  return qs.join("&");
}

export type PanelState = "error" | "empty" | "no-match" | "rows";

/**
 * A failed fetch must never read as "no employees here" (that invites HR to
 * think the location is unstaffed), so error wins over empty; and an empty
 * result under an active filter is "no match", not "nobody assigned".
 */
export function panelState(source: "api" | "error" | string, rowCount: number, filtered: boolean): PanelState {
  if (source === "error") return "error";
  if (rowCount > 0) return "rows";
  return filtered ? "no-match" : "empty";
}

export function pageWindow(total: number, page: number, pageSize = PAGE_SIZE) {
  return {
    from: total > 0 ? page * pageSize + 1 : 0,
    to: Math.min((page + 1) * pageSize, total),
    hasPrev: page > 0,
    hasNext: (page + 1) * pageSize < total,
    needsPaging: total > pageSize,
  };
}

export function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
