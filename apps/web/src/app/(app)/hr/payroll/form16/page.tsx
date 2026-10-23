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
  /** How many failures were recorded in all; errorDetails carries at most a capped prefix. */
  errorDetailsTotal?: number;
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

// GAP-PAYROLL-FORM16-05: the bulk job's errorDetails, as returned by
// payroll-service GET bulk-status: one { employeeNo, reasonCode } row per failed
// employee (a run-level failure has employeeNo "N/A"), capped server-side, with
// errorDetailsTotal giving the full count. The service strips the raw exception
// text, and this page ignores any other key (an older service that still sends
// `error` / `message` / `employeeId` has them dropped by the parse), so backend
// error text and internal ids can never be rendered. A reasonCode the page does
// not know shows the generic "no reason recorded" copy. Anything that is not an
// array of such rows falls back to the failure COUNT only.
const errorDetailsSchema = z.array(z.object({
  employeeNo: z.string().optional(),
  reasonCode: z.string().optional(),
})).optional();

const RUN_LEVEL_EMPLOYEE_NO = "N/A";
/** Defence in depth: the service already caps the list; never render an unbounded one. */
const MAX_FAILURE_ROWS = 100;

/** Stable reasonCode (form16-pdf/failure-reasons.ts) -> form16 i18n key. */
const FAILURE_REASON_KEYS = {
  DATA_UNAVAILABLE: "failureReasonDataUnavailable",
  RENDERER_UNAVAILABLE: "failureReasonRendererUnavailable",
  SIGNING_FAILED: "failureReasonSigningFailed",
  STORAGE_ERROR: "failureReasonStorageError",
  UNKNOWN: "failureReasonUnknown",
} as const;

function failureReasonKey(code: string | undefined): (typeof FAILURE_REASON_KEYS)[keyof typeof FAILURE_REASON_KEYS] {
  return code !== undefined && Object.prototype.hasOwnProperty.call(FAILURE_REASON_KEYS, code)
    ? FAILURE_REASON_KEYS[code as keyof typeof FAILURE_REASON_KEYS]
    : "failureReasonUnknown";
}

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

export default async function Form16Page(
  props: {
    searchParams: Promise<{ fy?: string }>;
  }
) {
  const searchParams = await props.searchParams;
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
                    const rows = parsed.success && parsed.data ? parsed.data.slice(0, MAX_FAILURE_ROWS) : null;
                    const recorded = Math.max(
                      parsed.success && parsed.data ? parsed.data.length : 0,
                      typeof lookup.job.errorDetailsTotal === "number" ? lookup.job.errorDetailsTotal : 0,
                    );
                    return (
                      <details style={{ marginTop: 10, fontSize: 13 }}>
                        <summary>{t("failureDetailsSummary", { count: lookup.job.failed })}</summary>
                        {rows ? (
                          <>
                            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>
                              {rows.map((row, i) => {
                                const reason = t(failureReasonKey(row.reasonCode));
                                const runLevel = row.employeeNo === RUN_LEVEL_EMPLOYEE_NO;
                                const who = runLevel ? t("failureRunLevel") : row.employeeNo?.trim() ? row.employeeNo.trim() : t("failureEmployeeUnknown");
                                return <li key={i}>{t("failureRow", { employee: who, message: reason })}</li>;
                              })}
                            </ul>
                            {recorded > rows.length && (
                              <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 6 }}>
                                {t("failureRowsTruncated", { count: recorded - rows.length })}
                              </p>
                            )}
                          </>
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
