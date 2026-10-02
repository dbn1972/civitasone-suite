import * as React from "react";

// React's `cache` exists in the canary React Next uses for server components, but not in the stable
// build vitest loads; fall back to the plain function there (no dedupe, same behaviour).
type CacheFn = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A) => R;
const cache: CacheFn = (React as unknown as { cache?: CacheFn }).cache ?? ((fn) => fn);

export type Vacancy = {
  id: string; title: string; refNo: string; vacancyType: string;
  location?: string; qualification?: string; payRange?: string;
  vacancies: number; description?: string; postedAt?: string; closesAt?: string;
  /** Server-computed (status + published + precise deadline); absent on older backends. */
  applicationOpen?: boolean;
  closedReason?: string;
};

export type VacancyResult =
  | { status: "ok"; vacancy: Vacancy }
  | { status: "notfound" }
  | { status: "error" };

// GAP-RECRUITMENT-CAREERS-DETAIL-06: only a real 404 is "not found". A timeout,
// a network failure or a 5xx is an outage and must not render "404 — Page not
// found". Wrapped in React cache() so generateMetadata and the page share ONE fetch.
export const getVacancy = cache(async (id: string): Promise<VacancyResult> => {
  const base = (process.env.CIVITASONE_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
  const tenantId = process.env.DEMO_TENANT_ID || "00000000-0000-0000-0000-000000000001";
  try {
    const res = await fetch(`${base}/api/v1/careers/vacancies/${encodeURIComponent(id)}`, {
      headers: { "x-tenant-id": tenantId },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404 || res.status === 400) return { status: "notfound" };
    if (!res.ok) return { status: "error" };
    return { status: "ok", vacancy: (await res.json()) as Vacancy };
  } catch {
    return { status: "error" };
  }
});

/**
 * Prefer the server's verdict (`applicationOpen`, same gate POST /apply enforces).
 * Only when an older backend omits it do we fall back to the deadline date.
 */
export function isClosed(v: Pick<Vacancy, "applicationOpen" | "closesAt">, now: Date = new Date()): boolean {
  if (typeof v.applicationOpen === "boolean") return !v.applicationOpen;
  return Boolean(v.closesAt && new Date(v.closesAt) < now);
}

