import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

const GATEWAY = (process.env.CIVITASONE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const TENANT_ID = process.env.DEMO_TENANT_ID ?? process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? "";

type Stage = { stage: string; label: string; status: "done" | "active" | "future"; note?: string };
type AppDetail = {
  id: string;
  applicationNo: string | null;
  stage: string;
  status: string;
  appliedAt: string;
  screeningDecision: string;
  screeningRemarks: string | null;
  job: { id: string; title: string; refNo: string; location: string | null; description: string | null; payRange: string | null; vacancies: number; closesAt: string | null } | null;
  timeline: Stage[];
};

async function fetchApplication(token: string, id: string): Promise<AppDetail | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0]!, "base64url").toString()) as { tenantId?: string };
    const tenantId = payload.tenantId ?? TENANT_ID;
    const res = await fetch(`${GATEWAY}/api/v1/careers/portal/applications/${id}`, {
      headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.json() as AppDetail;
  } catch { return null; }
}

const STAGE_DOT: Record<string, { bg: string; ring?: string }> = {
  done:   { bg: "#047857" },
  active: { bg: "#e07b00", ring: "0 0 0 4px rgba(224,123,0,0.2)" },
  future: { bg: "#cbd5e1" },
};

export default async function ApplicationDetailPage({ params }: { params: { id: string } }) {
  const token = cookies().get("cand_token")?.value;
  if (!token) redirect("/careers/portal/login");

  const app_ = await fetchApplication(token, params.id);
  if (!app_) notFound();

  const { job, timeline, applicationNo } = app_;

  return (
    <main style={{ minHeight: "100vh", background: "#f0f4f8", paddingBottom: 64 }}>
      {/* Header */}
      <div style={{ background: "#154089", padding: "14px 24px" }}>
        <Link href="/careers/portal" style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>← My Applications</Link>
        <h1 style={{ color: "#fff", fontSize: 17, fontWeight: 700, margin: "6px 0 2px" }}>
          {job?.title ?? "Application Detail"}
        </h1>
        <p style={{ color: "#93c5fd", fontSize: 13, margin: 0 }}>
          {job?.refNo ? `${job.refNo} · ` : ""}{job?.location ?? "India"}
        </p>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "20px 16px", display: "grid", gap: 16 }}>
        {/* Application number */}
        <div style={{ background: "#fff", borderRadius: 10, padding: "14px 16px", border: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8" }}>Application Number</div>
              <div style={{ fontSize: 17, fontWeight: 900, fontFamily: "monospace", color: "#154089", letterSpacing: "0.1em", marginTop: 2 }}>
                {applicationNo ?? app_.id.slice(0, 8).toUpperCase()}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>Applied on</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginTop: 2 }}>
                {app_.appliedAt ? new Date(app_.appliedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
              </div>
            </div>
          </div>
        </div>

        {/* Stage Rail */}
        <div style={{ background: "#fff", borderRadius: 10, padding: "16px 16px 20px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8", marginBottom: 16 }}>
            Application Journey
          </div>
          <div style={{ position: "relative", paddingLeft: 28 }}>
            {/* vertical track line */}
            <div style={{ position: "absolute", left: 7, top: 6, width: 2, bottom: 6, background: "#e2e8f0" }} />
            {timeline.map((s, i) => {
              const dot = STAGE_DOT[s.status] ?? STAGE_DOT.future!;
              const isLast = i === timeline.length - 1;
              return (
                <div key={s.stage} style={{ position: "relative", marginBottom: isLast ? 0 : 20 }}>
                  {/* green track segment for done */}
                  {!isLast && s.status === "done" && (
                    <div style={{ position: "absolute", left: -21, top: 14, width: 2, height: "calc(100% + 6px)", background: "#047857" }} />
                  )}
                  <div style={{ position: "absolute", left: -24, top: 3, width: 14, height: 14, borderRadius: "50%", background: dot.bg, boxShadow: dot.ring ?? "none", border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {s.status === "done" && <span style={{ fontSize: 8, color: "#fff", fontWeight: 800 }}>✓</span>}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: s.status === "future" ? "#94a3b8" : "#0f172a" }}>
                    {s.label}
                  </div>
                  {s.note && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    {new Date(s.note).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </div>}
                  {s.status === "active" && app_.screeningRemarks && (
                    <div style={{ marginTop: 6, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#92400e" }}>
                      {app_.screeningRemarks}
                    </div>
                  )}
                  {s.status === "active" && !app_.screeningRemarks && (
                    <div style={{ marginTop: 6, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#64748b" }}>
                      In progress — we will notify you by email when this stage updates.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Job info */}
        {job && (
          <div style={{ background: "#fff", borderRadius: 10, padding: "14px 16px", border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8", marginBottom: 10 }}>Vacancy Details</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {job.payRange && <InfoItem label="Pay" value={job.payRange} />}
              {job.vacancies && <InfoItem label="Posts" value={String(job.vacancies)} />}
              {job.location && <InfoItem label="Location" value={job.location} />}
              {job.closesAt && <InfoItem label="Closed" value={new Date(job.closesAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} />}
            </div>
          </div>
        )}

        <Link href="/careers" style={{ display: "block", textAlign: "center", color: "#154089", fontSize: 14, fontWeight: 600 }}>
          Browse more vacancies →
        </Link>
      </div>
    </main>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#334155", marginTop: 2 }}>{value}</div>
    </div>
  );
}
