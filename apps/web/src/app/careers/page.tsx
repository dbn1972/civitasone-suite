import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Careers — CivitasOne",
  description: "Browse current job openings, internships, and apprenticeships. Apply online — no login needed.",
};

export const dynamic = "force-dynamic";

type Vacancy = {
  id: string;
  title: string;
  refNo: string;
  vacancyType: string;
  location?: string;
  qualification?: string;
  payRange?: string;
  vacancies: number;
  description?: string;
  postedAt?: string;
  closesAt?: string;
};

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  regular: { label: "Regular", color: "#1e40af", bg: "#dbeafe" },
  internship: { label: "Internship", color: "#7c2d12", bg: "#fed7aa" },
  apprenticeship: { label: "Apprenticeship", color: "#166534", bg: "#bbf7d0" },
  contractual: { label: "Contractual", color: "#6b21a8", bg: "#e9d5ff" },
  deputation: { label: "Deputation", color: "#475569", bg: "#e2e8f0" },
};

async function getVacancies(): Promise<Vacancy[]> {
  const base = (process.env.CIVITASONE_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
  const tenantId = process.env.DEMO_TENANT_ID || "00000000-0000-0000-0000-000000000001";
  try {
    const res = await fetch(`${base}/api/v1/careers/vacancies`, {
      headers: { "x-tenant-id": tenantId },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data || json) as Vacancy[];
  } catch {
    return [];
  }
}

export default async function CareersPage() {
  const vacancies = await getVacancies();

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 40%)", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Hero */}
      <header style={{ textAlign: "center", padding: "56px 24px 40px", maxWidth: 800, margin: "0 auto" }}>
        <div style={{ fontSize: 36, marginBottom: 8 }} aria-hidden="true">◈</div>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: "#0f172a", margin: "0 0 12px", letterSpacing: "-0.5px" }}>
          Join Our Team
        </h1>
        <p style={{ fontSize: 17, color: "#475569", lineHeight: 1.6, margin: 0, maxWidth: 600, marginInline: "auto" }}>
          Browse current openings for regular positions, internships, and apprenticeships.
          Apply online — no account needed.
        </p>
      </header>

      {/* Vacancies */}
      <section style={{ maxWidth: 880, margin: "0 auto", padding: "0 24px 64px" }} aria-label="Open positions">
        {vacancies.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0" }}>
            <p style={{ fontSize: 44, marginBottom: 12 }} aria-hidden="true">📋</p>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>No openings right now</h2>
            <p style={{ color: "#64748b", fontSize: 15 }}>Check back soon — new positions are added regularly.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {vacancies.map((v) => {
              const typeInfo = TYPE_LABELS[v.vacancyType] ?? TYPE_LABELS.regular;
              return (
                <Link
                  key={v.id}
                  href={`/careers/${v.id}`}
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  <article
                    style={{
                      background: "#fff", borderRadius: 14, padding: "24px 28px",
                      border: "1px solid #e2e8f0",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 6, color: typeInfo.color, background: typeInfo.bg }}>
                        {typeInfo.label}
                      </span>
                      {v.closesAt && (
                        <span style={{ fontSize: 12, color: "#64748b" }}>
                          Apply by {new Date(v.closesAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      )}
                    </div>
                    <h2 style={{ fontSize: 19, fontWeight: 700, color: "#0f172a", margin: "0 0 8px", letterSpacing: "-0.2px" }}>
                      {v.title}
                    </h2>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13.5, color: "#475569" }}>
                      {v.location && <span>📍 {v.location}</span>}
                      {v.payRange && <span>💰 {v.payRange}</span>}
                      {v.vacancies > 1 && <span>👥 {v.vacancies} positions</span>}
                      {v.qualification && <span>🎓 {v.qualification}</span>}
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer style={{ textAlign: "center", padding: "24px", borderTop: "1px solid #e2e8f0", color: "#94a3b8", fontSize: 13 }}>
        Powered by CivitasOne · Equal opportunity employer
      </footer>
    </main>
  );
}
