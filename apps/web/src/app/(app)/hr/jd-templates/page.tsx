import Link from "next/link";
import { PageHeader, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { ArchiveTemplateButton } from "./JdTemplateActions";
import { typeBadge } from "./typeBadge";
import { getTranslations } from "next-intl/server";
import { HR_STAFF_ROLES } from "@/lib/auth/workRoles";

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

// GAP-HR-JD-TEMPLATES-NEW-01: the id the create form appends (?created=<id>)
// when it redirects here after a 202; only a well-formed UUID is ever used.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GAP-HR-JD-TEMPLATES-02: the closed set of values this page (and the API's
// own `vacancyType` filter) actually understands -- used both to build the
// filter chips and, below, to reject an out-of-list `?type=` value instead
// of interpolating it into the API path unvalidated.
const KNOWN_TYPES = ["regular", "internship", "apprenticeship", "volunteership", "contractual", "deputation"] as const;

async function fetchTemplates(type?: string): Promise<LoaderResult<JdTemplate[]>> {
  const path = type
    ? `/api/v1/hrms/jd-templates?${new URLSearchParams({ vacancyType: type }).toString()}`
    : "/api/v1/hrms/jd-templates";
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
const JD_TEMPLATE_ADMIN_ROLES = HR_STAFF_ROLES;

export default async function JdTemplatesPage({ searchParams }: { searchParams: { type?: string; created?: string } }) {
  const t = await getTranslations("jdTemplates");

  // GAP-HR-JD-TEMPLATES-01: every jd-templates route (including the list
  // itself) is HR_ROLES-only on the backend, but /hr/layout.tsx admits
  // manager/employee/payroll roles too -- they used to reach this page,
  // make a doomed fetch, and see the generic retryable "couldn't load"
  // error instead of an honest, permanent "Access restricted". Checking
  // canManage before ever calling fetchTemplates() also skips that doomed
  // API call entirely.
  const roles = getSessionRoles();
  const canManage = roles.some((r: string) => JD_TEMPLATE_ADMIN_ROLES.includes(r));
  if (!canManage) {
    return <PermissionDenied module="JD templates" requiredRoles={JD_TEMPLATE_ADMIN_ROLES} />;
  }

  // GAP-HR-JD-TEMPLATES-02: `searchParams.type` used to be interpolated
  // straight into the API path (`?vacancyType=${type}`) with no validation
  // or encoding -- a crafted value could inject extra query params on this
  // same endpoint. Only a value from the known, closed set is ever sent;
  // anything else is treated as "no filter" (same as today's "All types").
  const rawType = searchParams.type ?? "";
  const activeType = (KNOWN_TYPES as readonly string[]).includes(rawType) ? rawType : "";
  const result = await fetchTemplates(activeType || undefined);
  const { data: templates, source } = result;

  // GAP-HR-JD-TEMPLATES-NEW-01: creating a template only queues a command, so
  // the list a moment after the redirect may not contain it yet. With
  // ?created=<id> the new card is highlighted once it appears, and until it
  // does a pending row says it is on its way (instead of the list silently
  // looking like the save was lost). A type filter that could legitimately
  // exclude it suppresses the pending row.
  const createdId = typeof searchParams.created === "string" && UUID_RE.test(searchParams.created) ? searchParams.created : "";
  const createdLanded = createdId !== "" && templates.some((tmpl) => tmpl.id === createdId);
  const showPendingRow = createdId !== "" && !createdLanded && !activeType && source !== "error";

  const typeOptions = [
    { value: "", label: t("filterAllTypes") },
    { value: "regular", label: t("filterRegular") },
    { value: "internship", label: t("filterInternship") },
    { value: "apprenticeship", label: t("filterApprenticeship") },
    { value: "volunteership", label: t("filterVolunteer") },
    { value: "contractual", label: t("filterContractual") },
    // GAP-HR-JD-TEMPLATES-03: "Deputation" has been a valid vacancyType in
    // TYPE_LABELS above and in the create form's own VACANCY_TYPES since
    // this page was built, but had no filter chip -- those templates were
    // only ever reachable via "All types".
    { value: "deputation", label: t("filterDeputation") },
  ];

  return (
    <div className="page-main">
      <PageHeader
        title={t("title")}
        back="/hr" backLabel="Back to HR"
        subtitle={t("subtitle")}
        actions={
          <Link href="/hr/jd-templates/new" className="btn primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span aria-hidden="true">+</span> {t("newTemplate")}
          </Link>
        }
      />

      {/* Type filter */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }} role="group" aria-label={t("filterGroupLabel")}>
        {typeOptions.map((opt) => (
          <Link
            key={opt.value}
            href={opt.value ? `/hr/jd-templates?type=${opt.value}` : "/hr/jd-templates"}
            aria-current={activeType === opt.value ? "page" : undefined}
            style={{
              padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600, textDecoration: "none",
              background: activeType === opt.value ? "var(--primary)" : "var(--bg)",
              color: activeType === opt.value ? "var(--panel)" : "var(--ink2)",
              border: `1px solid ${activeType === opt.value ? "var(--primary)" : "var(--line)"}`,
            }}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      {source === "error" ? (
        <LoadErrorState result={result} area="JD templates" backHref="/hr" requiredRoles={JD_TEMPLATE_ADMIN_ROLES} />
      ) : templates.length === 0 && !showPendingRow ? (
        <div style={{ textAlign: "center", padding: "48px 24px", background: "var(--panel)", borderRadius: 12, border: "1px solid var(--line)" }}>
          <p style={{ fontSize: 40, margin: "0 0 12px" }}>📄</p>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>{t("emptyTitle")}</h2>
          <p style={{ color: "var(--mut)", fontSize: 14, margin: "0 0 16px" }}>{t("emptyMessage")}</p>
          <Link href="/hr/jd-templates/new" className="btn primary">
            {t("createTemplate")}
          </Link>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
            {showPendingRow && (
              <article
                role="status"
                aria-live="polite"
                data-testid="jd-template-pending"
                style={{ background: "var(--panel)", border: "1px dashed var(--primary)", borderRadius: 12, padding: "20px", display: "flex", flexDirection: "column", gap: 10 }}
              >
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--ink)", lineHeight: 1.3 }}>{t("pendingTitle")}</h3>
                <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)", lineHeight: 1.5 }}>{t("pendingMessage")}</p>
                <div>
                  <Link href={`/hr/jd-templates?created=${createdId}`} className="btn-outline">{t("pendingRefresh")}</Link>
                </div>
              </article>
            )}
            {templates.map((tmpl) => {
              const badge = typeBadge(tmpl.vacancyType);
              const ti = badge
                ? { label: t(badge.labelKey), color: badge.color, bg: badge.bg }
                : { label: tmpl.vacancyType, color: "var(--indigo)", bg: "var(--infobg)" };
              const isNew = tmpl.id === createdId;
              return (
                <article
                  key={tmpl.id}
                  id={`template-${tmpl.id}`}
                  aria-current={isNew ? "true" : undefined}
                  style={{ background: "var(--panel)", border: isNew ? "2px solid var(--primary)" : "1px solid var(--line)", borderRadius: 12, padding: "20px", display: "flex", flexDirection: "column", gap: 10 }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--ink)", lineHeight: 1.3 }}>{tmpl.name}</h3>
                    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: "2px 8px", borderRadius: 5, color: ti.color, background: ti.bg }}>
                      {ti.label}
                    </span>
                  </div>
                  {isNew && (
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--primary)" }}>{t("justAdded")}</p>
                  )}
                  {tmpl.description && (
                    <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {tmpl.description}
                    </p>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 12, color: "var(--mut)" }}>
                    {tmpl.payRange && <span style={{ background: "var(--bg)", padding: "2px 8px", borderRadius: 4, border: "1px solid var(--line)" }}>{tmpl.payRange}</span>}
                    {tmpl.qualification && <span style={{ background: "var(--bg)", padding: "2px 8px", borderRadius: 4, border: "1px solid var(--line)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tmpl.qualification}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                    {/* GAP-HR-JD-TEMPLATES-04: "Use template" wrapped in the
                        same canManage the rest of the page is now gated
                        behind (future-proofing -- today canManage is always
                        true here since the whole page 403s otherwise). */}
                    {canManage && (
                      <Link
                        href={`/hr/recruitment/new?templateId=${tmpl.id}`}
                        className="btn primary"
                        style={{ flex: 1, textAlign: "center" }}
                      >
                        {t("useTemplate")}
                      </Link>
                    )}
                    <Link
                      href={`/hr/jd-templates/${tmpl.id}`}
                      className="btn-outline"
                    >
                      {t("edit")}
                    </Link>
                    <ArchiveTemplateButton id={tmpl.id} name={tmpl.name} />
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--mut)" }}>
                    {t("usedCount", { count: tmpl.useCount })}
                  </p>
                </article>
              );
            })}
          </div>
          {/* GAP-HR-JD-TEMPLATES-06: this page passes no limit/pagination,
              so the backend's own default cap (100, jd-template-routes.ts)
              silently truncates a tenant with more templates than that --
              a plain notice beats pretending the grid above is the whole
              catalogue. */}
          {templates.length >= 100 && (
            <p style={{ marginTop: 16, fontSize: 13, color: "var(--mut)", textAlign: "center" }}>
              {t("showingFirstN", { count: templates.length })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
