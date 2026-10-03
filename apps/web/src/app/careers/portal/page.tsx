import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CAREERS_ACTIVE, CAREERS_MUTED, CAREERS_PRIMARY, SR_ONLY } from "../theme";
import { RAIL_STEPS, stageInfo } from "./stages";
import { PAGE_SIZE, clampPage, pageRedirectTarget } from "./paging";
import { CareersHeader, careersHeaderProps } from "../CareersHeader";
import { getCareersOrg } from "../organisation";

const GATEWAY = (process.env.CIVITASONE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const TENANT_ID = process.env.DEMO_TENANT_ID ?? process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? "";
const EXPIRED_LOGIN = "/careers/portal/login?expired=1";

type AppSummary = {
  id: string;
  applicationNo: string | null;
  jobTitle: string | null;
  jobLocation: string | null;
  jobRefNo: string | null;
  stage: string;
  status: string;
  appliedAt: string;
};

type FetchResult =
  | { kind: "ok"; applications: AppSummary[]; total: number }
  // No usable session (malformed token, or the API said 401): send the candidate back to sign in.
  | { kind: "unauthenticated" }
  // Network failure, timeout or 5xx: retrying can help.
  | { kind: "error" };

// UX-013: this used to return `[]` on ANY failure (bad response or network
// error) with no signal preserved anywhere -- a real outage of the careers
// portal service rendered pixel-identical to "no applications yet" for a
// candidate who may well have applications on record.
// GAP-RECRUITMENT-CAREERS-PORTAL-03/-04: an invalid/expired/malformed token is
// "unauthenticated" (redirect to login), never the retry card or the empty state.
async function fetchApplications(token: string, page: number): Promise<FetchResult> {
  const parts = token.split(".");
  if (parts.length !== 2) return { kind: "unauthenticated" };
  try {
    const payload = JSON.parse(Buffer.from(parts[0]!, "base64url").toString()) as { tenantId?: string };
    const tenantId = payload.tenantId ?? TENANT_ID;
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
    const res = await fetch(`${GATEWAY}/api/v1/careers/portal/applications?${qs.toString()}`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-tenant-id": tenantId,
      },
      cache: "no-store",
      // A stalled gateway must not block the render indefinitely (PORTAL-08).
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 401) return { kind: "unauthenticated" };
    if (!res.ok) return { kind: "error" };
    const json = await res.json() as { data?: AppSummary[]; total?: number };
    const applications = json.data ?? [];
    return { kind: "ok", applications, total: typeof json.total === "number" ? json.total : applications.length };
  } catch {
    return { kind: "error" };
  }
}

export const metadata = { title: "My Applications — Careers Portal" };

export default async function PortalPage({ searchParams }: { searchParams?: { page?: string } }) {
  const token = cookies().get("cand_token")?.value;
  if (!token) redirect("/careers/portal/login");

  const page = clampPage(searchParams?.page);
  const result = await fetchApplications(token, page);
  if (result.kind === "unauthenticated") redirect(EXPIRED_LOGIN);

  const errored = result.kind === "error";
  const applications = result.kind === "ok" ? result.applications : [];
  const total = result.kind === "ok" ? result.total : 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Past the last page: go to the last page, not "No applications yet".
  const target = pageRedirectTarget(result, page);
  if (target) redirect(target);
  // Read after the applications, so the primary request stays the first one made.
  const org = await getCareersOrg();

  return (
    <main style={{ minHeight: "100vh", background: "#f0f4f8", paddingBottom: 64 }}>
      <CareersHeader {...await careersHeaderProps(org)} />
      {/* Header */}
      <div style={{ background: CAREERS_PRIMARY, padding: "16px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <Link href="/careers" style={{ color: "#bfdbfe", fontSize: 13, textDecoration: "none" }}>← Vacancies</Link>
        <span style={{ color: "#bfdbfe" }} aria-hidden="true">|</span>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>My Applications</span>
        <span style={{ flex: 1 }} />
        <form method="POST" action="/api/careers/auth/logout" style={{ margin: 0 }}>
          <button type="submit" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#bfdbfe", fontSize: 13 }}>Sign out</button>
        </form>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px" }}>Your Applications</h1>
        <p style={{ margin: "0 0 20px", color: CAREERS_MUTED, fontSize: 14 }}>
          {errored ? "Couldn't load your application count." : `${total} application${total !== 1 ? "s" : ""} on record`}
        </p>

        {errored ? (
          <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0" }}>
            <p style={{ fontSize: 36, margin: "0 0 12px" }} aria-hidden="true">⚠️</p>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Couldn&apos;t load your applications</h2>
            <p style={{ color: CAREERS_MUTED, fontSize: 14, margin: "0 0 16px" }}>We couldn&apos;t reach the careers service. Please try again in a moment.</p>
            <Link href="/careers/portal" style={{ display: "inline-block", padding: "10px 20px", background: CAREERS_PRIMARY, color: "#fff", borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
              Try again
            </Link>
          </div>
        ) : applications.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0" }}>
            <p style={{ fontSize: 36, margin: "0 0 12px" }} aria-hidden="true">📭</p>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>No applications yet</h2>
            <p style={{ color: CAREERS_MUTED, fontSize: 14, margin: "0 0 16px" }}>Browse current vacancies and submit your first application.</p>
            <Link href="/careers" style={{ display: "inline-block", padding: "10px 20px", background: CAREERS_PRIMARY, color: "#fff", borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
              Browse Vacancies →
            </Link>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {applications.map((app) => {
              const info = stageInfo(app.stage);
              const title = app.jobTitle ?? "Position no longer listed";
              // No fabricated "India": omit the location when the vacancy has none.
              const subtitle = [app.jobRefNo, app.jobLocation].filter(Boolean).join(" · ");
              return (
                <Link key={app.id} href={`/careers/portal/application/${app.id}`} aria-label={`${title}, status ${info.label}`} style={{ textDecoration: "none" }}>
                  <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", transition: "box-shadow 0.15s" }}>
                    <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{title}</div>
                          {subtitle && <div style={{ fontSize: 13, color: CAREERS_MUTED, marginTop: 2 }}>{subtitle}</div>}
                        </div>
                        <span style={{ ...info.tone, padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
                          {info.label}
                        </span>
                      </div>
                    </div>
                    {info.kind === "rail" ? (
                      <MiniRail railIndex={info.railIndex} />
                    ) : info.kind === "terminal" ? (
                      <p style={{ margin: 0, padding: "10px 16px", fontSize: 13, color: "#334155" }}>{info.message}</p>
                    ) : null}
                    <div style={{ padding: "8px 16px", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: CAREERS_MUTED }}>
                        <span style={{ fontFamily: "monospace" }}>{app.applicationNo ?? app.id.slice(0, 8).toUpperCase()}</span>
                        {app.appliedAt && !Number.isNaN(Date.parse(app.appliedAt)) && (
                          <> · Applied on {new Date(app.appliedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</>
                        )}
                      </span>
                      <span style={{ fontSize: 12, color: "#0e7490", fontWeight: 600 }}>View details →</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {!errored && pageCount > 1 && (
          <nav aria-label="Pagination" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, marginTop: 20, fontSize: 14 }}>
            {page > 1 ? <Link href={`/careers/portal?page=${page - 1}`} rel="prev" style={{ color: CAREERS_PRIMARY, fontWeight: 700 }}>← Newer</Link> : <span style={{ color: CAREERS_MUTED }}>← Newer</span>}
            <span style={{ color: "#475569" }}>Page {Math.min(page, pageCount)} of {pageCount}</span>
            {page < pageCount ? <Link href={`/careers/portal?page=${page + 1}`} rel="next" style={{ color: CAREERS_PRIMARY, fontWeight: 700 }}>Older →</Link> : <span style={{ color: CAREERS_MUTED }}>Older →</span>}
          </nav>
        )}
      </div>
    </main>
  );
}

/** Progress as an ordered list: text states for AT, aria-current on the active step, 12px labels, darker active colour. */
function MiniRail({ railIndex }: { railIndex: number }) {
  return (
    <ol aria-label="Application progress" style={{ listStyle: "none", margin: 0, padding: "10px 16px", display: "flex" }}>
      {RAIL_STEPS.map((label, i) => {
        const state = i < railIndex ? "completed" : i === railIndex ? "current" : "upcoming";
        const dot = i < railIndex ? "#047857" : i === railIndex ? CAREERS_ACTIVE : "#cbd5e1";
        return (
          <li key={label} aria-current={i === railIndex ? "step" : undefined} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", width: "100%" }} aria-hidden="true">
              <span style={{ flex: 1, height: 2, background: i === 0 ? "transparent" : i <= railIndex ? "#047857" : "#e2e8f0" }} />
              <span style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, background: dot, boxShadow: i === railIndex ? "0 0 0 3px rgba(180,83,9,0.2)" : "none" }} />
              <span style={{ flex: 1, height: 2, background: i === RAIL_STEPS.length - 1 ? "transparent" : i < railIndex ? "#047857" : "#e2e8f0" }} />
            </span>
            <span style={{ fontSize: 12, marginTop: 4, textAlign: "center", overflowWrap: "anywhere", color: i === railIndex ? CAREERS_ACTIVE : CAREERS_MUTED, fontWeight: i === railIndex ? 700 : 400 }}>
              {label}
              <span style={SR_ONLY}> ({state})</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
