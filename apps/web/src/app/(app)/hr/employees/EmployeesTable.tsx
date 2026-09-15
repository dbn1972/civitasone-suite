"use client";

import Link from "next/link";
import { DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

export type EmpRow = { id: string; employeeNo?: string; name: string; department: string; status: string } & Record<string, unknown>;

const columns: { key: keyof EmpRow & string; label: string; cellType?: "status" }[] = [
  { key: "employeeNo", label: "Emp Code" },
  { key: "name", label: "Name" },
  { key: "department", label: "Department" },
  { key: "status", label: "Status", cellType: "status" },
];

export function EmployeesTable({ employees, source = "api" }: { employees: EmpRow[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<EmpRow[]>(
    "hr.employees",
    employees,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<EmpRow>
        columns={columns}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/hr/employees/"
        identifyingColumnKey="name"
        sortable
        filterable
        filterPlaceholder="Search by name, code or department…"
        pageSize={15}
        exportable
        emptyIcon="👥"
        emptyTitle="Your team starts here"
        emptyMessage="Add your first employee to unlock leave management, attendance tracking, and payroll processing."
        emptyAction={
          <Link href="/hr/employees/new" className="btn primary" style={{ marginTop: 10 }}>
            Add first employee
          </Link>
        }
      />
    </>
  );
}
