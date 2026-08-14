import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ApplyForm } from "./ApplyForm";

type Vacancy = {
  id: string; title: string; refNo: string; vacancyType: string;
  location?: string; qualification?: string; payRange?: string;
  vacancies: number; description?: string; postedAt?: string; closesAt?: string;
};

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  regular:       { label: "Regular Position",  color: "#1e40af", bg: "#dbeafe" },
  internship:    { label: "Internship",         color: "#7c2d12", bg: "#fed7aa" },
  apprenticeship:{ label: "Apprenticeship",     color: "#166534", bg: "#bbf7d0" },
  volunteership: { label: "Volunteer Role",     color: "#0e7490", bg: "#cffafe" },
  contractual:   { label: "Contractual",        color: "#6b21a8", bg: "#e9d5ff" },
  deputation:    { label: "Deputation",         color: "#475569", bg: "#e2e8f0" },
};

async function getVacancy(id: string): Promise<Vacancy | null> {
  const base = (process.env.CIVITASONE_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
  const tenantId = process.env.DEMO_TENANT_ID || "00000000-0000-0000-0000-000000000001";
  try {
    const res = await fetch(`${base}/api/v1/careers/vacancies/${id}`, {
      headers: { "x-tenant-id": tenantId },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const v = await getVacancy(params.id);
  return { title: v ? `${v.title} — Careers` : "Vacancy — Careers" };
}

export const dynamic = "force-dynamic";

export default async function VacancyPage({ params }: { params: { id: string } }) {
  const v = await getVacancy(params.id);
  if (!v) notFound();

  const closed = v.closesAt && new Date(v.closesAt) < new Date();

  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px 64px" }}>
        <a href="/careers" style={{ fontSize: 13, color: "#4f46e5", textDecoration: "none", display: "inline-block", marginBottom: 20 }}>
          ← All openings
        </a>

        <article style={{ background: "#fff", borderRadius: 16, padding: "32px", border: "1px solid #e2e8f0" }}>
          {(() => {
            const ti = TYPE_LABELS[v.vacancyType] ?? { label: v.vacancyType, color: "#4f46e5", bg: "#eef2ff" };
            return (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 6, color: ti.color, background: ti.bg }}>
                  {ti.label}
                </span>
                <span style={{ fontSize: 12, color: "#64748b" }}>Ref: {v.refNo}</span>
              </div>
            );
          })()}

          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", margin: "0 0 16px", letterSpacing: "-0.3px" }}>
            {v.title}
          </h1>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
            {v.location && <InfoCard icon="📍" label="Location" value={v.location} />}
            {v.payRange && <InfoCard icon="💰" label="Pay / Stipend" value={v.payRange} />}
            <InfoCard icon="👥" label="Positions" value={String(v.vacancies)} />
            {v.qualification && <InfoCard icon="🎓" label="Qualification" value={v.qualification} />}
            {v.closesAt && <InfoCard icon="📅" label="Apply by" value={new Date(v.closesAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} />}
          </div>

          {v.description && (
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#334155", margin: "0 0 8px" }}>About this role</h2>
              <p style={{ color: "#475569", lineHeight: 1.7, fontSize: 14.5, whiteSpace: "pre-wrap", margin: 0 }}>
                {v.description}
              </p>
            </div>
          )}

          {closed ? (
            <div style={{ padding: "16px 20px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 14, fontWeight: 600 }}>
              Applications for this position are closed.
            </div>
          ) : (
            <>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", margin: "0 0 16px", paddingTop: 8, borderTop: "1px solid #e2e8f0" }}>
                Apply now
              </h2>
              <ApplyForm jobOpeningId={v.id} vacancyType={v.vacancyType} />
            </>
          )}
        </article>
      </div>
    </main>
  );
}

function InfoCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#f8fafc", borderRadius: 10, border: "1px solid #f1f5f9" }}>
      <span aria-hidden="true">{icon}</span>
      <div>
        <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
        <div style={{ fontSize: 14, color: "#0f172a", fontWeight: 600 }}>{value}</div>
      </div>
    </div>
  );
}
