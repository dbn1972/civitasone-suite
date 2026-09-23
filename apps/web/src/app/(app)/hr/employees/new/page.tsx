import { PageHeader } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { AddEmployeeWizard } from "./AddEmployeeWizard";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";

type Dept = { id: string; name: string };
type Desig = { id: string; name: string };
type EmpSummary = { id: string; name: string; designationName?: string };

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

async function getManagers(): Promise<LoaderResult<EmpSummary[]>> {
  return fetchJson<unknown, EmpSummary[]>("/api/v1/hrms/employees?role=manager&limit=200", [], {
    telemetryKey: "hr.new-employee.managers",
    mapResponse: (p) => (p as { data: EmpSummary[] })?.data ?? null,
  });
}

export default async function NewEmployeePage() {
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => EMPLOYEE_ADMIN_ROLES.includes(r));

  if (!canAdminister) {
    return <PermissionDenied module="adding an employee" requiredRoles={EMPLOYEE_ADMIN_ROLES} />;
  }

  const t = await getTranslations("employeeWizard");
  const [deptResult, desigResult, managerResult] = await Promise.all([
    getDepartments(),
    getDesignations(),
    getManagers(),
  ]);

  const departments = deptResult.data ?? [];
  const designations = desigResult.data ?? [];
  const managers = managerResult.data ?? [];

  const hasError =
    deptResult.source === "error" ||
    desigResult.source === "error" ||
    managerResult.source === "error";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back="/hr/employees"
        backLabel={t("backLabel")}
      />
      <DataSourceBadge source={hasError ? "error" : "api"} />
      <AddEmployeeWizard
        departments={departments}
        designations={designations}
        managers={managers}
      />
    </main>
  );
}
