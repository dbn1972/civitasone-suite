"use client";

import Link from "next/link";
import { DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { useTranslations } from "next-intl";

export type EmpRow = { id: string; employeeNo?: string; name: string; department: string; status: string } & Record<string, unknown>;

export function EmployeesTable({ employees, source = "api" }: { employees: EmpRow[]; source?: "api" | "error" }) {
  const t = useTranslations("employeesTable");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<EmpRow[]>(
    "hr.employees",
    employees,
    source,
    (d) => d.length === 0,
  );

  const columns: { key: keyof EmpRow & string; label: string; cellType?: "status" }[] = [
    { key: "employeeNo", label: t("colEmpCode") },
    { key: "name", label: t("colName") },
    { key: "department", label: t("colDepartment") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

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
        caption="Employee roster with name, department, designation, and status"
        identifyingColumnKey="name"
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        exportable
        emptyIcon="👥"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
        emptyAction={
          <Link href="/hr/employees/new" className="btn primary" style={{ marginTop: 10 }}>
            {t("addFirstEmployee")}
          </Link>
        }
      />
    </>
  );
}
