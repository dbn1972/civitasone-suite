/**
 * Server-side loader for the candidate portal application detail page.
 *
 * GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-03: every failure used to collapse to
 * notFound(), so an expired session or an outage read as "404 - Page not found". The result is
 * now discriminated so the page can redirect to sign-in (401/403/bad token), show a retry card
 * (5xx / network) and reserve notFound() for a real 404.
 */

export type StageEntry = {
  stage: string;
  label: string;
  status: "done" | "active" | "future" | "ended";
  /** ISO instant when the step happened / is scheduled; empty when unknown. */
  note?: string;
  /** Present on the interview step only while a confirmed slot exists. */
  interview?: { at: string; mode: string; durationMinutes: number; venue: string | null; meetingLink: string | null };
};

export type AppDetail = {
  id: string;
  applicationNo: string | null;
  stage: string;
  status: string;
  appliedAt: string;
  // Terminal outcome (not selected / withdrawn) with fixed, candidate-safe wording.
  // Internal HR screening remarks are intentionally never sent to this page.
  outcome?: { kind: "not_selected" | "withdrawn"; message: string } | null;
  job: { id: string; title: string; refNo: string; location: string | null; description: string | null; payRange: string | null; vacancies: number; closesAt: string | null } | null;
  timeline: StageEntry[];
};

export type ApplicationResult =
  | { kind: "ok"; app: AppDetail }
  | { kind: "notfound" }
  | { kind: "unauthorized" }
  | { kind: "error" };

export async function fetchApplication(
  token: string,
  id: string,
  opts: { gateway: string; fallbackTenantId: string },
): Promise<ApplicationResult> {
  const parts = token.split(".");
  if (parts.length !== 2) return { kind: "unauthorized" };
  try {
    const payload = JSON.parse(Buffer.from(parts[0]!, "base64url").toString()) as { tenantId?: string };
    const tenantId = payload.tenantId ?? opts.fallbackTenantId;
    const res = await fetch(`${opts.gateway}/api/v1/careers/portal/applications/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
      cache: "no-store",
    });
    if (res.status === 404) return { kind: "notfound" };
    if (res.status === 401 || res.status === 403) return { kind: "unauthorized" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", app: (await res.json()) as AppDetail };
  } catch {
    // A malformed token payload (JSON.parse) is a bad session; a network failure is an outage.
    return { kind: "error" };
  }
}
