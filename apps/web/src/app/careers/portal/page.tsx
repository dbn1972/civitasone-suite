import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

const GATEWAY = (process.env.CIVITASONE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const TENANT_ID = process.env.DEMO_TENANT_ID ?? process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? "";

type AppSummary = {
  id: string;
  applicationNo: string | null;
  jobTitle: string;
  jobLocation: string | null;
  jobRefNo: string | null;
  stage: string;
  status: string;
  appliedAt: string;
};

const STAGE_LABEL: Record<string, string> = {
  applied: "Applied",
  screening: "Under Review",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offered: "Offer Issued",
  hired: "Joined",
};

const STAGE_COLOR: Record<string, { bg: string; color: string }> = {
  applied:     { bg: "#f1f5f9", color: "#475569" },
  screening:   { bg: "#dbeafe", color: "#1e40af" },
  shortlisted: { bg: "#cffafe", color: "#0e7490" },
  interview:   { bg: "#fef3c7", color: "#92400e" },
  offered:     { bg: "#ede9fe", color: "#6d28d9" },
  hired:       { bg: "#d1fae5", color: "#065f46" },
};

async function fetchApplications(token: string): Promise<AppSummary[]> {
  const parts = token.split(".");
  if (parts.length !== 2) return [];
  try {
    const payload = JSON.parse(Buffer.from(parts[0]!, "base64url").toString()) as { tenantId?: string };
    const tenantId = payload.tenantId ?? TENANT_ID;
    const res = await fetch(`${GATEWAY}/api/v1/careers/portal/applications`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-tenant-id": tenantId,
      },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = await res.json() as { data: AppSummary[] };
    return json.data ?? [];
  } catch { return []; }
}

export const metadata = { title: "My Applications — Careers Portal" };

export default async function PortalPage() {
  const token = cookies().get("cand_token")?.value;
  if (!token) redirect("/careers/portal/login");

  const applications = await fetchApplications(token);

  return (
    <main style={{ minHeight: "100vh", background: "#f0f4f8", paddingBottom: 64 }}>
      {/* Header */}
      <div style={{ background: "#154089", padding: "16px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <Link href="/careers" style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>← Vacancies</Link>
        <span style={{ color: "#93c5fd" }}>|</span>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>My Applications</span>
        <span style={{ flex: 1 }} />
        <Link href="/api/careers/auth/logout" style={{ color: "#93c5fd", fontSize: 13 }}>Sign out</Link>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px" }}>Your Applications</h1>
        <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: 14 }}>
          {applications.length} application{applications.length !== 1 ? "s" : ""} on record
        </p>

        {applications.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0" }}>
            <p style={{ fontSize: 36, margin: "0 0 12px" }}>📭</p>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>No applications yet</h2>
            <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 16px" }}>Browse current vacancies and submit your first application.</p>
            <Link href="/careers" style={{ display: "inline-block", padding: "10px 20px", background: "#154089", color: "#fff", borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
              Browse Vacancies →
            </Link>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {applications.map((app) => {
              const sc = STAGE_COLOR[app.stage] ?? STAGE_COLOR.applied!;
              return (
                <Link key={app.id} href={`/careers/portal/application/${app.id}`} style={{ textDecoration: "none" }}>
                  <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", transition: "box-shadow 0.15s" }}>
                    <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{app.jobTitle}</div>
                          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
                            {app.jobRefNo ? `${app.jobRefNo} · ` : ""}{app.jobLocation ?? "India"}
                          </div>
                        </div>
                        <span style={{ ...sc, padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
                          {STAGE_LABEL[app.stage] ?? app.stage}
                        </span>
                      </div>
                    </div>
                    {/* Mini stage rail */}
                    <MiniRail stage={app.stage} />
                    <div style={{ padding: "8px 16px", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#94a3b8", fontFamily: "monospace" }}>
                        {app.applicationNo ?? app.id.slice(0, 8).toUpperCase()}
                      </span>
                      <span style={{ fontSize: 12, color: "#0891b2", fontWeight: 600 }}>View details →</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function MiniRail({ stage }: { stage: string }) {
  const STAGES = ["applied", "screening", "shortlisted", "interview", "offered", "hired"];
  const idx = STAGES.indexOf(stage);
  return (
    <div style={{ padding: "10px 16px" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {STAGES.map((s, i) => (
          <span key={s} style={{ display: "flex", alignItems: "center", flex: i < STAGES.length - 1 ? "1" : "none" }}>
            <span style={{
              width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
              background: i < idx ? "#047857" : i === idx ? "#e07b00" : "#cbd5e1",
              boxShadow: i === idx ? "0 0 0 3px rgba(224,123,0,0.2)" : "none",
            }} />
            {i < STAGES.length - 1 && (
              <span style={{ flex: 1, height: 2, background: i < idx ? "#047857" : "#e2e8f0" }} />
            )}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {["Applied", "Review", "Shortlisted", "Interview", "Offer", "Joined"].map((l, i) => (
          <span key={l} style={{ fontSize: 10, color: i === idx ? "#e07b00" : "#94a3b8", fontWeight: i === idx ? 700 : 400, flex: 1, textAlign: i === 0 ? "left" : i === 5 ? "right" : "center" }}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
