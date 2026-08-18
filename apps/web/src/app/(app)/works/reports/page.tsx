import { fetchJson } from "@/app/_data/apiClient";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { ReportFilters } from "./ReportFilters";

// --- API response shapes ---
interface SummaryApi {
  data: { totalWorks: number; activeWorks: number; closedWorks: number };
}
interface StatusApi {
  data: { status: string; count: number }[];
}
interface WorksApi {
  data: {
    id: string;
    workNumber: string;
    description: string;
    category: string;
    estimatedCostMinor: string;
    status: string;
    district: string;
    createdAt: string;
  }[];
}

// --- Loader output shapes ---
type SummaryData = { totalWorks: number; activeWorks: number; closedWorks: number };
type StatusItem = { status: string; count: number };
type WorkApiRow = {
  id: string;
  workNumber: string;
  description: string;
  category: string;
  estimatedCostMinor: string;
  status: string;
  district: string;
  createdAt: string;
};

function buildQuery(sp: {
  fromDate?: string;
  toDate?: string;
  divisionId?: string;
}): string {
  const params = new URLSearchParams();
  if (sp.fromDate) params.set("fromDate", sp.fromDate);
  if (sp.toDate) params.set("toDate", sp.toDate);
  if (sp.divisionId) params.set("divisionId", sp.divisionId);
  const q = params.toString();
  return q ? `?${q}` : "";
}

function humanizeStatus(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface PageProps {
  searchParams?: { fromDate?: string; toDate?: string; divisionId?: string };
}

export default async function WorksReportsPage({ searchParams }: PageProps) {
  const sp = searchParams ?? {};
  const qs = buildQuery(sp);

  const [
    { data: summary, source: sSource },
    { data: statusItems, source: stSource },
    { data: works, source: wSource },
  ] = await Promise.all([
    fetchJson<SummaryApi, SummaryData>(
      `/api/v1/works/reports/summary${qs}`,
      { totalWorks: 0, activeWorks: 0, closedWorks: 0 },
      {
        telemetryKey: "works.reports.summary",
        mapResponse: (payload) => payload.data ?? null,
      },
    ),
    fetchJson<StatusApi, StatusItem[]>(
      `/api/v1/works/reports/status${qs}`,
      [],
      {
        telemetryKey: "works.reports.status",
        mapResponse: (payload) => payload.data ?? null,
      },
    ),
    fetchJson<WorksApi, WorkApiRow[]>(
      `/api/v1/works/reports/works${qs}${qs ? "&" : "?"}page=1&pageSize=100`,
      [],
      {
        telemetryKey: "works.reports.works",
        mapResponse: (payload) => payload.data ?? null,
      },
    ),
  ]);

  const hasError = sSource === "error" || stSource === "error" || wSource === "error";

  const sortedStatus = [...statusItems].sort((a, b) => b.count - a.count);

  const statusRows: Record<string, unknown>[] = sortedStatus.map((s) => ({
    status: s.status,
    label: humanizeStatus(s.status),
    count: s.count,
  }));

  const workRows: Record<string, unknown>[] = works.map((row) => ({
    workNumber: row.workNumber,
    description:
      row.description.length > 60
        ? `${row.description.slice(0, 60)}…`
        : row.description,
    category: row.category,
    estimatedCost: formatMoney(String(row.estimatedCostMinor ?? "0")),
    status: row.status,
    district: row.district,
    createdAt: formatIndianDate(row.createdAt),
  }));

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Works Reports"
        subtitle="Summary and status of all engineering works"
        back="/works"
        actions={hasError ? <DataSourceBadge source="error" /> : null}
      />

      <ReportFilters
        fromDate={sp.fromDate}
        toDate={sp.toDate}
        divisionId={sp.divisionId}
      />

      <StatGrid>
        <StatCard
          icon="🏗"
          iconBg="#eef2ff"
          label="Total Works"
          value={summary.totalWorks}
        />
        <StatCard
          icon="🟢"
          iconBg="#ecfdf3"
          label="Active Works"
          value={summary.activeWorks}
        />
        <StatCard
          icon="🔒"
          iconBg="#f1f5f9"
          label="Closed Works"
          value={summary.closedWorks}
        />
      </StatGrid>

      <Card title="Status Breakdown">
        <DataTable
          columns={[
            { key: "label", label: "Status" },
            { key: "count", label: "Count", align: "right" },
          ]}
          rows={statusRows}
          sortable
          caption="Status breakdown of engineering works"
          emptyIcon="📊"
          emptyTitle="No status data"
          emptyMessage="No status breakdown available for the selected filters."
        />
      </Card>

      <Card title="Works Register">
        <DataTable
          columns={[
            { key: "workNumber", label: "Work No." },
            { key: "description", label: "Description" },
            { key: "category", label: "Category" },
            { key: "estimatedCost", label: "Est. Cost", align: "right" },
            { key: "status", label: "Status", cellType: "status" },
            { key: "district", label: "District" },
            { key: "createdAt", label: "Created" },
          ]}
          rows={workRows}
          filterable
          filterPlaceholder="Search works…"
          sortable
          exportable
          exportFilename="works-register"
          caption="Works register — full list of engineering works"
          emptyIcon="🏗"
          emptyTitle="No works found"
          emptyMessage="No works match the selected filters."
        />
      </Card>
    </main>
  );
}
