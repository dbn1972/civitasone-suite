import Link from "next/link";
import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";

export const dynamic = "force-dynamic";
export const metadata = { title: "JD Template Library — HR" };

type JdTemplate = {
  id: string;
  name: string;
  vacancyType: string;
  description?: string;
  qualification?: string;
  payRange?: string;
  tags?: string[];
  useCount: number;
  createdAt: string;
};

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  regular:       { label: "Regular",       color: "#1e40af", bg: "#dbeafe" },
  internship:    { label: "Internship",    color: "#7c2d12", bg: "#fed7aa" },
  apprenticeship:{ label: "Apprenticeship",color: "#166534", bg: "#bbf7d0" },
  volunteership: { label: "Volunteer",     color: "#0e7490", bg: "#cffafe" },
  contractual:   { label: "Contractual",   color: "#6b21a8", bg: "#e9d5ff" },
  deputation:    { label: "Deputation",    color: "#475569", bg: "#e2e8f0" },
};

async function fetchTemplates(type?: string): Promise<LoaderResult<JdTemplate[]>> {
  const path = type ? `/api/v1/hrms/jd-templates?vacancyType=${type}` : "/api/v1/hrms/jd-templates";
  return fetchJson<unknown, JdTemplate[]>(path, [], {
    telemetryKey: "hr.jd_templates",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: JdTemplate[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

/**
 * Mirrors jd-template-routes.ts: ALL operations require
 * HR_ROLES = ["hr_admin", "hr_officer", "super_admin"].
 */
const JD_TEMPLATE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function JdTemplatesPage({ searchParams }: { searchParams: { type?: string } }) {
  const activeType = searchParams.type ?? "";
  const { data: templates, source } = await fetchTemplates(activeType || undefined);
  const roles = getSessionRoles();
  const canManage = roles.some((r: string) => JD_TEMPLATE_ADMIN_ROLES.includes(r));

  const typeOptions = [
    { value: "", label: "All types" },
    { value: "regular", label: "Regular" },
    { value: "internship", label: "Internship" },
    { value: "apprenticeship", label: "Apprenticeship" },
    { value: "volunteership", label: "Volunteer" },
    { value: "contractual", label: "Contractual" },
  ];

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="JD Template Library"
        subtitle="Reusable job description templates — select one to pre-fill a new job opening."
        actions={
          canManage ? (
            <Link
              href="/hr/jd-templates/new"
              className="btn btn-primary"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", background: "#154089", color: "#fff", borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: "none" }}
            >
              + New template
            </Link>
          ) : undefined
        }
      />

      {/* Type filter */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {typeOptions.map((opt) => (
          <Link
            key={opt.value}
            href={opt.value ? `/hr/jd-templates?type=${opt.value}` : "/hr/jd-templates"}
            style={{
              padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600, textDecoration: "none",
              background: activeType === opt.value ? "#154089" : "#f1f5f9",
              color: activeType === opt.value ? "#fff" : "#475569",
              border: `1px solid ${activeType === opt.value ? "#154089" : "#e2e8f0"}`,
            }}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      {source === "error" ? (
        <RefreshErrorState error={toHumanError("load", { area: "JD templates" })} />
      ) : templates.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 24px", background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0" }}>
          <p style={{ fontSize: 40, margin: "0 0 12px" }}>📄</p>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>No templates yet</h2>
          <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 16px" }}>Create your first JD template to speed up future job openings.</p>
          {canManage && (
            <Link href="/hr/jd-templates/new" style={{ display: "inline-block", padding: "10px 20px", background: "#154089", color: "#fff", borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
              Create template
            </Link>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {templates.map((tmpl) => {
            const ti = TYPE_LABELS[tmpl.vacancyType] ?? { label: tmpl.vacancyType, color: "#4f46e5", bg: "#eef2ff" };
            return (
              <article key={tmpl.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "20px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a", lineHeight: 1.3 }}>{tmpl.name}</h3>
                  <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: "2px 8px", borderRadius: 5, color: ti.color, background: ti.bg }}>
                    {ti.label}
                  </span>
                </div>
                {tmpl.description && (
                  <p style={{ margin: 0, fontSize: 13, color: "#475569", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {tmpl.description}
                  </p>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 12, color: "#64748b" }}>
                  {tmpl.payRange && <span style={{ background: "#f8fafc", padding: "2px 8px", borderRadius: 4, border: "1px solid #e2e8f0" }}>{tmpl.payRange}</span>}
                  {tmpl.qualification && <span style={{ background: "#f8fafc", padding: "2px 8px", borderRadius: 4, border: "1px solid #e2e8f0", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tmpl.qualification}</span>}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <Link
                    href={`/hr/recruitment/new?templateId=${tmpl.id}`}
                    style={{ flex: 1, textAlign: "center", padding: "8px", background: "#154089", color: "#fff", borderRadius: 7, fontWeight: 700, fontSize: 13, textDecoration: "none" }}
                  >
                    Use template
                  </Link>
                  {canManage && (
                    <Link
                      href={`/hr/jd-templates/${tmpl.id}`}
                      style={{ padding: "8px 12px", background: "#f1f5f9", color: "#475569", borderRadius: 7, fontWeight: 600, fontSize: 13, textDecoration: "none" }}
                    >
                      Edit
                    </Link>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: 11, color: "var(--mut)" }}>
                  Used {tmpl.useCount} time{tmpl.useCount !== 1 ? "s" : ""}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
