import Link from "next/link";
import { PageHeader, Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Apar = {
  id: string;
  employeeId: string;
  appraisalPeriod: string;
  status: string;
  overallBand: string | null;
  overallGrade: string | null;
  updatedAt: string;
} & Record<string, unknown>;

async function getApars(): Promise<LoaderResult<Apar[]>> {
  return fetchJson<unknown, Apar[]>("/api/v1/hrms/apar", [], {
    telemetryKey: "apar.list",
    mapResponse: (p) => {
      const arr = (p as Record<string, unknown>)?.data;
      return Array.isArray(arr) ? (arr as Apar[]) : null;
    },
  });
}

const COLUMNS = [
  { key: "employeeId" as const,      label: "Employee ID" },
  { key: "appraisalPeriod" as const, label: "Period" },
  { key: "status" as const,          label: "Stage", cellType: "status" as const },
  { key: "overallBand" as const,     label: "Band" },
  { key: "updatedAt" as const,       label: "Last Updated" },
];

export default async function AparListPage() {
  const result = await getApars();
  const apars = result.data;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="APAR / Annual Performance Appraisal"
        subtitle="Manage SPARROW-style multi-authority appraisal workflow for all employees."
        help="hr"
        actions={
          <Link href="/hr/apar/new" className="btn primary">+ Initiate APAR</Link>
        }
      />
      {result.source === "error" && <DataSourceBadge source="error" />}

      <Card title="All APARs">
        {apars.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No APARs initiated yet"
            message="Initiate an APAR to start the annual performance appraisal cycle for an employee."
            action={<Link href="/hr/apar/new" className="btn primary">+ Initiate APAR</Link>}
          />
        ) : (
          <DataTable<Apar>
            columns={COLUMNS}
            rows={apars}
            rowLinkKey="id"
            rowLinkPrefix="/hr/apar/"
            sortable
            filterable
            filterPlaceholder="Filter by period, stage…"
            pageSize={20}
            emptyIcon="📋"
            emptyTitle="No matching APARs"
            emptyMessage="Adjust your filter to find the appraisal you need."
          />
        )}
      </Card>
    </main>
  );
}
