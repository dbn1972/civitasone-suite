"use client";

import Link from "next/link";
import { DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { useTranslations } from "next-intl";

export type EmpRow = { id: string; employeeNo?: string; name: string; department: string; status: string; dateOfJoining?: string } & Record<string, unknown>;

export function EmployeesTable({ employees, source = "api", canCreate = false }: { employees: EmpRow[]; source?: "api" | "error"; canCreate?: boolean }) {
  const t = useTranslations("employeesTable");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<EmpRow[]>(
    "hr.employees",
    employees,
    source,
    (d) => d.length === 0,
  );

  const columns: { key: keyof EmpRow & string; label: string; cellType?: "status" | "date" }[] = [
    { key: "employeeNo", label: t("colEmpCode") },
    { key: "name", label: t("colName") },
    { key: "department", label: t("colDepartment") },
    // GAP-HR-EMPLOYEES-05: employeeType is returned by the API (and, as of
    // this fix, actually forwarded by mapEmployees) but was never rendered.
    { key: "employeeType", label: t("colType") },
    // GAP-HR-EMPLOYEES-06: reads dateOfJoining defensively -- the backend
    // (employee/queries.ts listEmployees) does not return this field on
    // origin/main yet, so this renders "—" for now (DataTable's cellType
    // "date" already handles a missing/undefined value that way). Open PR
    // #1702 (GAP-HR-DASHBOARD-04) already adds exactly this field to the
    // same backend response; once it merges, this column starts showing
    // real dates with no further web-side change needed.
    { key: "dateOfJoining", label: t("colJoiningDate"), cellType: "date" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  // GAP-HR-EMPLOYEES-02: a real load failure (nothing cached either) must
  // read differently from a genuinely empty roster -- same row count (zero)
  // but a different reason, and only one of the two should ever invite HR
  // to "add your first employee".
  const isErrorEmpty = provenance === "error-no-data";

  // GAP-HR-EMPLOYEES-02: a failed load with nothing cached is an error, not
  // an empty roster. RefreshErrorState gives a real Retry (router.refresh()
  // re-runs the page's server fetches) and a way back, and never offers the
  // "add your first employee" call to action -- an HR admin must not be
  // invited to re-create staff during an outage (duplicate-record risk). It
  // is the single failure signal, so the provenance badge is not stacked on
  // top of it.
  if (isErrorEmpty) {
    return (
      <div className="pad">
        <RefreshErrorState
          error={{ what: t("emptyErrorTitle"), next: t("emptyErrorMessage"), actions: ["retry", "back", "help"] }}
          backHref="/hr"
        />
      </div>
    );
  }

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
        caption={t("caption")}
        identifyingColumnKey="name"
        sortable
        // GAP-HR-EMPLOYEES-04: removed the client-side `filterable` text
        // filter and `pageSize={15}` -- both operated only on whatever 50
        // rows the server handed this page, giving two independent,
        // disagreeing paginations and a search box that silently couldn't
        // find anyone outside the current page. The page above now does
        // real server-side search (?q=) and is the only pagination level.
        // GAP-HR-EMPLOYEES-04: the CSV is built client-side from the rows
        // this server page returned (at most one page), not the whole
        // filtered result -- say so next to the button instead of letting
        // "CSV" imply a full export. The export itself is audit-logged via
        // exportAudit.
        exportable exportAudit="hr/employees"
        exportNotice={t("exportNotice", { count: rows.length })}
        emptyIcon="👥"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
        emptyAction={
          canCreate ? (
            <Link href="/hr/employees/new" className="btn primary" style={{ marginTop: 10 }}>
              {t("addFirstEmployee")}
            </Link>
          ) : undefined
        }
      />
    </>
  );
}
