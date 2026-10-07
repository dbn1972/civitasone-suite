import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader, StatGrid, StatCard, Card, StatusPill, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { formatIndianDate } from "@/lib/formatters";
import { statusAwareGet } from "../_lib/statusAwareFetch";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { isValidFy } from "@/lib/validators/fy";
import { VerifyForm16Form } from "./VerifyForm16Form";
import { FyLookupForm } from "./FyLookupForm";
import { Form16Wizard } from "./Form16Wizard";

type BulkJob = {
  jobId: string;
  fy: string;
  status: string;
  totalEmployees: number;
  generated: number;
  failed: number;
  storagePrefix: string | null;
  errorDetails: unknown;
  createdAt: string;
  completedAt: string | null;
};

type JobLookup =
  | { state: "found"; job: BulkJob }
  | { state: "not_found" }
  | { state: "error" };

/** FY runs Apr–Mar; before April we're still in the FY that started last calendar year. */
function currentFy(): string {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

// GAP-PAYROLL-FORM16-06: the bulk-generate/bulk-status/bulk-download routes
// (payroll-service's form16-pdf/routes.ts) are all `requireRole(ctx,
// ADMIN_ROLES)` with ADMIN_ROLES = ["payroll_admin", "super_admin"] exactly
// -- narrower than hr/layout.tsx's broad HR_ROLES (which deliberately admits
// "manager"/"employee" for self-service elsewhere in /hr) and narrower even
// than hr/payroll/page.tsx's own local PAYROLL_ADMIN_ROLES (which also
// allows payroll_officer -- that role cannot reach these specific bulk
// endpoints). Page-local (not in lib/auth/workRoles.ts) because it mirrors
// ONE specific backend route group's role list exactly, not a broader
// pattern reused across pages, the same way hr/payroll/page.tsx's own
// PAYROLL_ADMIN_ROLES is page-local.
const FORM16_BULK_ADMIN_ROLES = ["payroll_admin", "super_admin"];

// GAP-PAYROLL-FORM16-05: the bulk job's errorDetails shape is not documented
// by the backend ("payroll tax service absent" from the original audit's
// snapshot, and still not pinned down by a shared type in this checkout).
// Parsed defensively so a shape that doesn't match this best-guess schema
// falls back to the failure COUNT only, never a raw JSON dump of backend
// internals (which may include employee ids/error text) to whatever role
// can reach this page.
const errorDetailsSchema = z.array(z.object({ employeeId: z.string(), message: z.string() })).optional();

async function getBulkStatus(fy: string): Promise<JobLookup> {
  const r = await statusAwareGet(`/v1/payroll/tax/form16/bulk-status?fy=${encodeURIComponent(fy)}`);
  if (r.kind === "ok") {
    const d = (r.body as { data?: BulkJob } | null)?.data;
    // REL-023: an unconfigured/empty backend response for this endpoint comes
    // back as `{ data: [] }` (an array), not a 404 -- `typeof [] === "object"`
    // and `[]` is truthy, so the old check let that array through as if it
    // were a real BulkJob. Every field read off it downstream (jobId, status,
    // ...) was then `undefined`, and <StatusPill status={undefined}> crashes
    // in status.toLowerCase() -- taking down the whole page (so even the
    // always-rendered PageHeader never painted). Require a real object.
    return d && typeof d === "object" && !Array.isArray(d)
      ? { state: "found", job: d as BulkJob }
      : { state: "error" };
  }
  if (r.kind === "http_error" && r.status === 404) return { state: "not_found" };
  return { state: "error" };
}

export default async function Form16Page({
  searchParams,
}: {
  searchParams: { fy?: string };
}) {
  const t = await getTranslations("form16");
  // FyLookupForm stays a plain synchronous component (see its own file for
  // why) so its copy is resolved here and passed down as props.
  const tFyLookup = await getTranslations("fyLookupForm");
  const fy = searchParams.fy && isValidFy(searchParams.fy) ? searchParams.fy : currentFy();

  // GAP-PAYROLL-FORM16-06: gate ONLY the bulk-generation wizard + bulk-
  // status card -- form16/verify (VerifyForm16Form below) is a separate
  // backend route explicitly open to "any authenticated user" (form16-
  // verify/routes.ts's own doc comment), so it stays available to every
  // role hr/layout.tsx already admits, same as before this change.
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => FORM16_BULK_ADMIN_ROLES.includes(r));
  const lookup = canAdminister ? await getBulkStatus(fy) : null;

  const source: "api" | "error" = lookup?.state === "error" ? "error" : "api";

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel={t("backLabel")}
      />

      {canAdminister ? (
        <>
          <DataSourceBadge source={source} message={t("loadErrorMessage")} />

          {/* Wizard: 3-step — select FY / review / generate & download.
              key={fy} forces a full remount whenever the URL-driven `fy`
              changes (e.g. via FyLookupForm below) -- Form16Wizard seeds
              several pieces of state (fy, step, jobId...) from `defaultFy`
              only once via useState(), so without a changing key a
              client-side navigation to a different ?fy= would silently
              leave the whole wizard (FY field, current step, any
              in-progress job) pinned to whatever FY was active on first
              mount. */}
          <Card title={t("wizardCardTitle")}>
            <Form16Wizard key={fy} defaultFy={fy} />
          </Card>

          <Card title={t("bulkStatusCardTitle", { fy })}>
            <div className="pad">
              <FyLookupForm
                defaultFy={fy}
                financialYearLabel={tFyLookup("financialYearLabel")}
                checkRunLabel={tFyLookup("checkRunBtn")}
                formatHint={tFyLookup("formatHint")}
              />

              {lookup?.state === "not_found" ? (
                <EmptyState
                  icon="🧾"
                  title={t("notFoundTitle", { fy })}
                  message={t("notFoundMessage")}
                />
              ) : lookup?.state !== "found" ? (
                <EmptyState
                  icon="⚠️"
                  title={t("errorStateTitle", { fy })}
                  message={t("errorStateMessage")}
                />
              ) : (
                <>
                  <StatGrid>
                    <StatCard icon="👥" iconBg="var(--infobg)" label={t("statTotalEmployees")} value={lookup.job.totalEmployees} />
                    <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statGenerated")} value={lookup.job.generated} />
                    <StatCard icon="⚠️" iconBg="var(--badbg)" label={t("statFailed")} value={lookup.job.failed} />
                    <StatCard
                      icon="⏳"
                      iconBg="var(--warnbg)"
                      label={t("statPending")}
                      value={Math.max(0, lookup.job.totalEmployees - lookup.job.generated - lookup.job.failed)}
                    />
                  </StatGrid>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                    <StatusPill status={lookup.job.status} />
                    <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                      {t("createdLabel", { date: formatIndianDate(lookup.job.createdAt) })}
                      {lookup.job.completedAt ? t("completedLabel", { date: formatIndianDate(lookup.job.completedAt) }) : ""}
                    </span>
                    {/* GAP-PAYROLL-FORM16-08: job id kept as a secondary,
                        copyable technical value -- not bolded/emphasized,
                        since it is not something HR normally needs. */}
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "monospace" }} title={t("jobLabel")}>
                      {lookup.job.jobId}
                    </span>
                  </div>
                  {lookup.job.status === "completed" && lookup.job.storagePrefix && (
                    <p style={{ fontSize: 13, marginTop: 10 }}>
                      <a
                        className="btn ghost sm"
                        href={"/api/proxy/v1/payroll/tax/form16/bulk-download?fy=" + encodeURIComponent(fy)}
                      >
                        <span aria-hidden="true">⬇</span> {t("downloadLinkLabel")}
                      </a>
                    </p>
                  )}
                  {lookup.job.failed > 0 && lookup.job.errorDetails != null && (() => {
                    const parsed = errorDetailsSchema.safeParse(lookup.job.errorDetails);
                    return (
                      <details style={{ marginTop: 10, fontSize: 13 }}>
                        <summary>{t("failureDetailsSummary", { count: lookup.job.failed })}</summary>
                        {parsed.success && parsed.data ? (
                          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>
                            {parsed.data.map((row, i) => (
                              <li key={i}>{t("failureRow", { employeeId: row.employeeId, message: row.message })}</li>
                            ))}
                          </ul>
                        ) : (
                          <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 6 }}>{t("failureDetailsUnavailable")}</p>
                        )}
                      </details>
                    );
                  })()}
                </>
              )}
            </div>
          </Card>
        </>
      ) : (
        <PermissionDenied module="Form 16 generation" requiredRoles={FORM16_BULK_ADMIN_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      )}

      <VerifyForm16Form />
    </div>
  );
}
