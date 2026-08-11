import { PageHeader } from "../../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { AddEmployeeForm } from "./AddEmployeeForm";

type Dept = { id: string; code: string; name: string } & Record<string, unknown>;
type Desig = { id: string; code: string; name: string } & Record<string, unknown>;

async function getDepartments(): Promise<Dept[]> {
  const r = await fetchJson<unknown, Dept[]>("/api/v1/hrms/departments", [], {
    telemetryKey: "hr.new-employee.departments",
    mapResponse: (p) => (p as { data: Dept[] })?.data ?? null,
  });
  return r.data;
}

async function getDesignations(): Promise<Desig[]> {
  const r = await fetchJson<unknown, Desig[]>("/api/v1/hrms/designations", [], {
    telemetryKey: "hr.new-employee.designations",
    mapResponse: (p) => (p as { data: Desig[] })?.data ?? null,
  });
  return r.data;
}

export default async function NewEmployeePage() {
  const [departments, designations] = await Promise.all([
    getDepartments(),
    getDesignations(),
  ]);

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Add Employee"
        subtitle="Add a new staff member to the employee directory."
        back="/hr/employees"
        backLabel="Employees"
      />
      <AddEmployeeForm departments={departments} designations={designations} />
    </main>
  );
}
