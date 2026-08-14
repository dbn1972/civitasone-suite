import { PageHeader } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { AddEmployeeWizard } from "./AddEmployeeWizard";

type Dept = { id: string; name: string };
type Desig = { id: string; name: string };
type EmpSummary = { id: string; name: string; designationName?: string };

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
    desigResult.source === "error";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Add Employee"
        subtitle="Complete all five steps to create a new employee record."
        back="/hr/employees"
        backLabel="Employees"
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
