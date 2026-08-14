import { PageHeader } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { AddEmployeeForm } from "./AddEmployeeForm";

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

export default async function NewEmployeePage() {
  const [deptResult, desigResult] = await Promise.all([
    getDepartments(),
    getDesignations(),
  ]);
  const departments = deptResult.data;
  const designations = desigResult.data;
  const source = deptResult.source === "error" || desigResult.source === "error" ? "error" : "api";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Add Employee"
        subtitle="Add a new staff member to the employee directory."
        back="/hr/employees"
        backLabel="Employees"
      />
      <DataSourceBadge source={source} />
      <AddEmployeeForm departments={departments} designations={designations} />
    </main>
  );
}
