import Link from "next/link";
import { PageHeader } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { AddEmployeeWizard } from "./AddEmployeeWizard";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";

type Dept = { id: string; name: string };
type Desig = { id: string; name: string };

/**
 * Mirrors services/hrms-service/src/modules/employee/routes.ts's HR_ROLES
 * guard on POST /v1/hrms/employees exactly. Checked before any of this
 * page's data loaders run, so an unauthorized role never even triggers the
 * departments/designations/managers fetches it can't do anything useful
 * with.
 */
const EMPLOYEE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

async function getDepartments(): Promise<LoaderResult<Dept[]>> {
  return fetchJson<unknown, Dept[]>("/api/v1/hrms/departments", [], {
    telemetryKey: "hr.new-employee.departments",
    mapResponse: (p) => (p as { data: Dept[] })?.data ?? null,
  });
}

async function getDesignations(): Promise<LoaderResult<Desig[]>> {
  return fetchJson<unknown, Desig[]>("/api/v1/hrms/designations", [], {
    telemetryKey: "hr.new-employee.designations",
    mapResponse: (p) => (p as { data: Desig[] })?.data ?? null,
  });
}

export default async function NewEmployeePage() {
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => EMPLOYEE_ADMIN_ROLES.includes(r));

  if (!canAdminister) {
    return <PermissionDenied module="adding an employee" requiredRoles={EMPLOYEE_ADMIN_ROLES} />;
  }

  const t = await getTranslations("employeeWizard");
  const [deptResult, desigResult] = await Promise.all([
    getDepartments(),
    getDesignations(),
  ]);

  const departments = deptResult.data ?? [];
  const designations = desigResult.data ?? [];

  const hasError =
    deptResult.source === "error" ||
    desigResult.source === "error";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back="/hr/employees"
        backLabel={t("backLabel")}
        // GAP-HR-EMPLOYEES-NEW-08: bulk import existed but had no link from
        // this page (or, until the employees-list cluster's fix, from the
        // employee directory either).
        actions={<Link href="/hr/employees/import" className="btn ghost">{t("importLink")}</Link>}
      />
      <DataSourceBadge source={hasError ? "error" : "api"} />
      <AddEmployeeWizard
        departments={departments}
        designations={designations}
      />
    </div>
  );
}
