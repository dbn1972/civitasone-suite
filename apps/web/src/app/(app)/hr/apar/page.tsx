import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
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

const COLUMNS: { key: keyof Apar & string; label: string; cellType?: "status" }[] = [
  { key: "employeeId", label: "Employee ID" },
  { key: "appraisalPeriod", label: "Period" },
  { key: "overallBand", label: "Band" },
  { key: "overallGrade", label: "Grade" },
  { key: "status", label: "Stage", cellType: "status" },
  { key: "updatedAt", label: "Last Updated" },
];

export default async function AparListPage() {
  const result = await getApars();
  const apars = result.data;

  const pending = apars.filter((a) => a.status === "pending" || a.status === "initiated").length;
  const inReview = apars.filter((a) => a.status === "ro_submitted" || a.status === "rv_submitted" || a.status === "under_review").length;
  const completed = apars.filter((a) => a.status === "closed" || a.status === "accepted").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="APAR — Annual Performance Appraisal"
        subtitle="SPARROW-style multi-authority appraisal workflow: Reporting Officer → Reviewing Officer → Accepting Authority."
        back="/hr"
        help="hr"
        actions={
          <Link href="/hr/apar/new" className="btn primary">+ Initiate APAR</Link>
        }
      />
      <DataSourceBadge source={result.source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total APARs" value={apars.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Initiated / Pending" value={pending} />
        <StatCard icon="🔍" iconBg="#e6f0ff" label="Under Review" value={inReview} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Closed / Accepted" value={completed} />
      </StatGrid>
      <Card title="APAR Records">
        <DataTable<Apar>
          columns={COLUMNS}
          rows={apars}
          rowLinkKey="id"
          rowLinkPrefix="/hr/apar/"
          sortable
          filterable
          filterPlaceholder="Filter by period or stage…"
          pageSize={20}
          emptyIcon="📋"
          emptyTitle="No APARs initiated yet"
          emptyMessage="Initiate an APAR to start the annual performance appraisal cycle. Each APAR moves through Reporting Officer → Reviewing Officer → Accepting Authority sign-off per SPARROW norms."
        />
      </Card>
    </main>
  );
}
