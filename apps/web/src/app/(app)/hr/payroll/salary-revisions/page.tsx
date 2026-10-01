import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { resolveEmployeeNames, employeeDisplayLabel } from "@/app/_data/employeeNames";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_REPORT_ROLES } from "@/lib/auth/roleGuard";
import { formatMoney } from "@/lib/formatters";
import { revisionTypeListLabelKey } from "@/lib/payroll/revisionTypes";
import { CreateSalaryRevisionForm } from "./CreateSalaryRevisionForm";

// HIGH fix: the comment this replaced claimed "payroll-service exposes GET
// /v1/payroll/salary-revisions but no create route" -- that was stale.
// POST /v1/payroll/salary-revisions (world-class-routes.ts) exists and
// works (publishes payroll.salary_revision.create; the consumer persists
// it), it just had zero UI callers. See CreateSalaryRevisionForm.tsx.

// GAP-PAYROLL-SALARY-REVISIONS-05: page.tsx had no getSessionRoles/
// PermissionDenied at all -- hr/layout.tsx's HR_ROLES admits manager and
// employee. The gates now mirror payroll-service exactly (PR #1756 review):
//  - GET /v1/payroll/salary-revisions requires world-class-routes.ts `ROLES`
//    (payroll_admin/payroll_officer/super_admin/hr_admin) == PAYROLL_REPORT_ROLES
//    -- finance_officer would get a 403, so it gets PermissionDenied here.
//  - POST requires payroll_admin/payroll_officer/super_admin
//    == PAYROLL_ADMIN_ROLES -- hr_admin sees the history but not the form.

type Row = {
  id: string;
  employee_id: string;
  effective_date: string;
  old_basic_minor: number | string;
  new_basic_minor: number | string;
  old_gross_minor: number | string;
  new_gross_minor: number | string;
  revision_type: string;
  order_no: string | null;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/payroll/salary-revisions", [], {
    telemetryKey: "payroll.salary-revisions",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

/** Exact BigInt delta (paise) as a signed display string; "—" if either side isn't an integer. */
function grossChangeLabel(oldMinor: number | string, newMinor: number | string): string {
  let delta: bigint;
  try {
    delta = BigInt(newMinor) - BigInt(oldMinor);
  } catch {
    return "—";
  }
  return `${delta > 0n ? "+" : ""}${formatMoney(delta)}`;
}

export default async function SalaryRevisionsPage() {
  const t = await getTranslations("salaryRevisions");
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_REPORT_ROLES.includes(r))) {
    return <PermissionDenied module="salary revisions" requiredRoles={PAYROLL_REPORT_ROLES} />;
  }
  const canCreate = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));

  const { data: rawItems, source } = await getData();
  const errored = source === "error";
  // GAP-PAYROLL-SALARY-REVISIONS-03: employee_id used to render as a raw
  // UUID. One batched hrms directory lookup (ids=, 50 per request) for just
  // the employees on this page -- the shared resolver the arrears/bonus/
  // corrections/reimbursements registers use -- instead of pulling the whole
  // directory. Unresolved ids fall back to "Unknown employee · <id prefix>".
  const names = await resolveEmployeeNames(rawItems.map((r) => r.employee_id));

  // Every field DataTable sees is a plain serialisable value: DataTable is a
  // "use client" component, so a `render:` function from this Server
  // Component would crash the page ("Functions cannot be passed directly to
  // Client Components") -- PR #1756 review B1. The employee link was dropped
  // for the same reason (rowHref is also a function).
  const items = rawItems.map((r) => {
    const key = revisionTypeListLabelKey(r.revision_type);
    return {
      ...r,
      revisionTypeLabel: key ? t(key) : r.revision_type,
      employeeLabel: employeeDisplayLabel(names, r.employee_id, t("unknownEmployee")),
      // GAP-PAYROLL-SALARY-REVISIONS-04: old_gross_minor was captured and
      // sent by the form but never shown, so an increment's gross delta
      // could not be audited from the list without the raw API response.
      grossChangeLabel: grossChangeLabel(r.old_gross_minor, r.new_gross_minor),
    };
  });
  type Row2 = (typeof items)[number];

  const columns: { key: keyof Row2 & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount"; sortable?: boolean }[] = [
    { key: "employeeLabel", label: t("colEmployee") },
    { key: "effective_date", label: t("colEffectiveDate") },
    { key: "revisionTypeLabel", label: t("colRevisionType") },
    { key: "old_basic_minor", label: t("colOldBasic"), align: "right", cellType: "amount" },
    { key: "new_basic_minor", label: t("colNewBasic"), align: "right", cellType: "amount" },
    { key: "old_gross_minor", label: t("colOldGross"), align: "right", cellType: "amount" },
    { key: "new_gross_minor", label: t("colNewGross"), align: "right", cellType: "amount" },
    // A display string would sort lexically, not numerically.
    { key: "grossChangeLabel", label: t("colGrossChange"), align: "right", sortable: false },
    { key: "order_no", label: t("colOrderNo") },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="📈" iconBg="var(--infobg)" label={t("statTotalRevisions")} value={errored ? null : items.length} />
        <StatCard icon="🏅" iconBg="var(--goodbg)" label={t("statIncrements")} value={errored ? null : items.filter((i) => i.revision_type === "annual_increment").length} />
        <StatCard icon="🎯" iconBg="var(--warnbg)" label={t("statPromotions")} value={errored ? null : items.filter((i) => i.revision_type === "promotion").length} />
        {/* GAP-PAYROLL-SALARY-REVISIONS-01: this was "Pay Commission",
            filtering on revision_type==='pay_commission' -- a value the
            form (and the backend's own zod validator) can never produce,
            so the stat could only ever read 0. "correction" is a real,
            submittable type (and, since payroll-service migration 0050, a
            DB-accepted one). */}
        <StatCard icon="🛠" iconBg="var(--panel)" label={t("statCorrections")} value={errored ? null : items.filter((i) => i.revision_type === "correction").length} />
      </StatGrid>

      {canCreate && <CreateSalaryRevisionForm />}

      <Card title={t("historyCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "salary revisions" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<Row2>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="📈"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
