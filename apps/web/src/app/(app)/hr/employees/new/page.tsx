import { fetchJson } from "../../../../_data/apiClient";
import { AddEmployeeForm } from "./AddEmployeeForm";

type Dept = { id: string; name: string };
type EmpSummary = { id: string; name: string; designationName?: string };

function extractNamedList(payload: unknown): { id: string; name: string }[] {
  if (typeof payload !== "object" || payload === null) return [];
  const p = payload as Record<string, unknown>;
  const arr: unknown[] = Array.isArray(p.data)
    ? (p.data as unknown[])
    : Array.isArray(p.items)
    ? (p.items as unknown[])
    : Array.isArray(payload)
    ? (payload as unknown[])
    : [];
  return arr.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const r = row as Record<string, unknown>;
    const id =
      typeof r.id === "string" && r.id.length > 0
        ? r.id
        : typeof r.empCode === "string" && r.empCode.length > 0
        ? r.empCode
        : null;
    const name = typeof r.name === "string" && r.name.length > 0 ? r.name : null;
    if (!id || !name) return [];
    return [{ id, name }];
  });
}

export default async function NewEmployeePage() {
  const [deptsRes, desigRes, empRes] = await Promise.all([
    fetchJson<unknown, Dept[]>("/api/v1/hrms/departments", [], {
      telemetryKey: "hr.departments",
      mapResponse: (p) => extractNamedList(p),
    }),
    fetchJson<unknown, Dept[]>("/api/v1/hrms/designations", [], {
      telemetryKey: "hr.designations",
      mapResponse: (p) => extractNamedList(p),
    }),
    fetchJson<unknown, EmpSummary[]>("/api/v1/hrms/employees?limit=200", [], {
      telemetryKey: "hr.managers_list",
      mapResponse: (p) => extractNamedList(p) as EmpSummary[],
    }),
  ]);

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <AddEmployeeForm
        departments={deptsRes.data}
        designations={desigRes.data}
        managers={empRes.data}
      />
    </main>
  );
}
