import Link from "next/link";
import { PageHeader, Card, EmptyState, StatGrid, StatCard, RefreshErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
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
  employeeCount?: number;
} & Record<string, unknown>;

async function getDepartments(): Promise<LoaderResult<Dept[]>> {
  try {
    const r = await fetchJson<unknown, Dept[]>("/api/v1/hrms/departments", [], {
      telemetryKey: "config.departments",
      mapResponse: (p) => (p as { data: Dept[] })?.data ?? null,
    });
    return r;
  } catch {
    return { data: [], source: "error" as const };
  }
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
  const { data: depts } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";
  const roles = getSessionRoles();
  const canEdit = roles.some((r) => DEPARTMENT_ADMIN_ROLES.includes(r));

  const rootDepts = errored ? null : depts.filter((d) => !d.parentId).length;
  const subDepts  = errored ? null : depts.filter((d) => !!d.parentId).length;
  const withCode  = errored ? null : depts.filter((d) => !!d.code).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel={t("backLabel")}
        help="hr"
        actions={
          <Link href="/hr/departments/new" style={newBtnStyle}>
            {t("newBtn")}
          </Link>
        }
      />

      {/* Breadcrumb */}
      <nav aria-label={t("breadcrumbNavLabel")} style={{ marginBottom: 12 }}>
        <ol
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            listStyle: "none",
            margin: 0,
            padding: 0,
            fontSize: 12,
            color: "var(--mut,#64748b)",
          }}
        >
          <li>
            <Link href="/" style={{ color: "var(--mut,#64748b)", textDecoration: "none" }}>
              {t("breadcrumbHome")}
            </Link>
          </li>
          <li aria-hidden="true" style={{ fontSize: 10 }}>›</li>
          <li>
            <Link href="/hr" style={{ color: "var(--mut,#64748b)", textDecoration: "none" }}>
              {t("backLabel")}
            </Link>
          </li>
          <li aria-hidden="true" style={{ fontSize: 10 }}>›</li>
          <li aria-current="page" style={{ fontWeight: 600, color: "var(--fg,#0f172a)" }}>
            {t("title")}
          </li>
        </ol>
      </nav>

      <StatGrid>
        <StatCard icon="🗂️" iconBg="#e6f0ff" label={t("statTotalLabel")} value={errored ? "—" : depts.length} />
        <StatCard icon="🌳" iconBg="#e6f7f0" label={t("statRootLabel")}  value={rootDepts ?? "—"} />
        <StatCard icon="🌿" iconBg="#fff7e6" label={t("statSubLabel")}   value={subDepts ?? "—"} />
        <StatCard icon="🏷️" iconBg="#f5f5f5" label={t("statWithCodeLabel")} value={withCode ?? "—"} />
      </StatGrid>

      <Card title={errored ? t("title") : t("cardTitleWithCount", { count: depts.length })}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "departments" })} backHref="/hr" />
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
    </main>
  );
}
