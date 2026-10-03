"use client";

import Link from "next/link";
import { DataTable } from "../../../../_components/ds";

export type LocationEmployeeRow = {
  id: string;
  employeeNo: string;
  name: string;
  designation: string;
  department: string;
  status: string;
};

type Labels = {
  colName: string;
  colEmpNo: string;
  colDesignation: string;
  colDepartment: string;
  caption: string;
  emptyIcon: string;
  emptyTitle: string;
  emptyMessage: string;
};

/**
 * Client wrapper so the name-cell `render` function never crosses the
 * Server->Client boundary (datatable-render-guard). Each name links to the
 * employee profile. Paging and search are server-side (see page.tsx).
 */
export function LocationEmployeesTable({ rows, labels }: { rows: LocationEmployeeRow[]; labels: Labels }) {
  return (
    <DataTable<LocationEmployeeRow>
      columns={[
        {
          key: "name",
          label: labels.colName,
          render: (row) => <Link href={`/hr/employees/${row.id}`} style={{ fontWeight: 500 }}>{row.name}</Link>,
        },
        { key: "employeeNo", label: labels.colEmpNo },
        { key: "designation", label: labels.colDesignation },
        { key: "department", label: labels.colDepartment },
      ]}
      rows={rows}
      caption={labels.caption}
      identifyingColumnKey="name"
      emptyIcon={labels.emptyIcon}
      emptyTitle={labels.emptyTitle}
      emptyMessage={labels.emptyMessage}
    />
  );
}
