import Link from "next/link";
import { PageHeader, Card, EmptyState, StatGrid, StatCard, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { DepartmentsTable } from "./DepartmentsTable";

/**
 * Mirrors services/hrms-service/src/modules/employee/masters-routes.ts's
 * HR_ROLES guard on PATCH/DELETE /v1/hrms/departments/:id exactly (same
 * constant departments/new/page.tsx already mirrors for the POST route).
 *
 * GET is gated server-side by the broader HR_READ_ROLES (also includes
 * manager/finance roles), so this page itself stays visible to them --
 * only the Edit/Delete affordances inside DepartmentsTable are restricted
 * to this narrower list.
 */
const DEPARTMENT_ADMIN_ROLES = ["hr_admin", "super_admin", "admin"];

type Dept = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  level?: number | null;
  employeeCount?: number;
} & Record<string, unknown>;

function getDepartments(): Promise<LoaderResult<Dept[]>> {
  // GAP-HR-DEPARTMENTS-08: this used to wrap fetchJson in a try/catch that
  // discarded the loader's `status`/`errorMessage` on any failure and
  // synthesised a bare `{data: [], source: "error"}` -- fetchJson itself
  // never throws (see apiClient.ts), so the catch branch was dead, but it
  // also meant a real 403 could never be told apart from a 500 here. Return
  // the full result so the Card below can render LoadErrorState correctly.
  return fetchJson<unknown, Dept[]>("/api/v1/hrms/departments", [], {
    telemetryKey: "config.departments",
    mapResponse: (p) => (p as { data: Dept[] })?.data ?? null,
  });
}

const newBtnStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "0 16px",
  display: "flex",
  alignItems: "center",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  background: "var(--primary)",
  color: "#fff",
  textDecoration: "none",
};

export default async function DepartmentsPage() {
  const t = await getTranslations("departments");
  const result = await getDepartments();
  const { data: depts, source, status, errorMessage } = result;
  const errored = source === "error";
  const roles = getSessionRoles();
  const canEdit = roles.some((r) => DEPARTMENT_ADMIN_ROLES.includes(r));

  const rootDepts = errored ? null : depts.filter((d) => !d.parentId).length;
  const subDepts  = errored ? null : depts.filter((d) => !!d.parentId).length;
  // GAP-HR-DEPARTMENTS-04: "With Code" was always == Total (code is a
  // required NOT NULL column, so every row always has one) -- a stat with
  // no information. Replaced with a metric that actually varies: how many
  // departments currently have zero employees, now that GET returns a real
  // employeeCount (GAP-HR-DEPARTMENTS-01).
  const noEmployeeDepts = errored ? null : depts.filter((d) => (d.employeeCount ?? 0) === 0).length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel={t("backLabel")}
        help="hr"
        actions={
          canEdit ? (
            <Link href="/hr/departments/new" style={newBtnStyle}>
              <span aria-hidden="true">+ </span>
              {t("newBtn")}
            </Link>
          ) : undefined
        }
      />

      {/* GAP-HR-DEPARTMENTS-06: this hand-rolled breadcrumb duplicated the
          global AutoBreadcrumb the AppShell TopBar already renders for every
          /hr/* route (Home > HR > Departments) -- two "go up" trails on one
          page, plus the PageHeader back link makes three. Removed; rely on
          AutoBreadcrumb like every other HR page. */}

      <StatGrid>
        <StatCard icon="🗂️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? "—" : depts.length} />
        <StatCard icon="🌳" iconBg="var(--goodbg, #e6f7f0)" label={t("statRootLabel")}  value={rootDepts ?? "—"} />
        <StatCard icon="🌿" iconBg="var(--warnbg, #fff7e6)" label={t("statSubLabel")}   value={subDepts ?? "—"} />
        <StatCard icon="👥" iconBg="var(--bg, #f5f5f5)" label={t("statNoEmployeesLabel")} value={noEmployeeDepts ?? "—"} />
      </StatGrid>

      {!canEdit && (
        <p
          role="note"
          id="departments-readonly-note"
          style={{ fontSize: 13, color: "var(--mut,#64748b)", margin: "4px 0 12px" }}
        >
          {t("readOnlyNote")}
        </p>
      )}

      <Card title={errored ? t("title") : t("cardTitleWithCount", { count: depts.length })}>
        {errored ? (
          <div className="pad" aria-describedby={!canEdit ? "departments-readonly-note" : undefined}>
            <LoadErrorState
              result={{ status, errorMessage }}
              area="departments"
              backHref="/hr"
              requiredRoles={DEPARTMENT_ADMIN_ROLES}
            />
          </div>
        ) : depts.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <DepartmentsTable depts={depts} canEdit={canEdit} />
        )}
      </Card>
    </div>
  );
}
