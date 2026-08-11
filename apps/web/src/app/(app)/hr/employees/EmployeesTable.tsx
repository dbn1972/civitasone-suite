"use client";

import Link from "next/link";
import { DataTable } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

export type EmpRow = { id: string; employeeNo?: string; name: string; department: string; status: string } & Record<string, unknown>;

const columns: { key: keyof EmpRow & string; label: string; cellType?: "status" }[] = [
  { key: "employeeNo", label: "Emp Code" },
  { key: "name", label: "Name" },
  { key: "department", label: "Department" },
  { key: "status", label: "Status", cellType: "status" },
];

export function EmployeesTable({ employees, source = "api" }: { employees: EmpRow[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<EmpRow[]>(
    "hr.employees",
    employees,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<EmpRow>
        columns={columns}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/hr/employees/"
        sortable
        filterable
        filterPlaceholder="Search by name, code or department…"
        pageSize={15}
        exportable
        emptyIcon="👥"
        emptyTitle="No people added yet"
        emptyMessage="Add the people who work in your office so you can manage their leave, attendance and pay."
        emptyAction={
          <Link href="/hr/employees/new" className="btn primary" style={{ marginTop: 10 }}>
            + Add Employee
          </Link>
        }
      />
    </>
  );
}
