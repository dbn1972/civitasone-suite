import { fetchJson } from "@/app/_data/apiClient";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney, formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { humanize } from "../_data/format";
import { toHumanError } from "@/lib/messages";
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

  const summaryError = sSource === "error";
  const statusError = stSource === "error";
  const worksError = wSource === "error";

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
    category: humanize(row.category),
    estimatedCost: formatMoney(String(row.estimatedCostMinor ?? "0")),
    status: row.status,
    district: row.district,
    createdAt: formatIndianDate(row.createdAt),
  }));

  // GAP-WORKS-REPORTS-03: the register is fetched at a fixed page=1&pageSize=100
  // and the API's meta.total is just the returned page length (not a true
  // count — see services/works-service/src/modules/reporting/repo.ts
  // listProposalsForReport), so a department with more than 100 works gets a
  // silently truncated register AND a truncated CSV export. We can't page
  // reliably without a real total, so we warn honestly when the page is full.
  const REGISTER_PAGE_SIZE = 100;
  const registerMaybeTruncated = !worksError && works.length >= REGISTER_PAGE_SIZE;

  // StatCard values: "—" when the summary block itself failed, so an errored
  // summary next to a populated register never reads as a real "0 works".
  const stat = (n: number): string | number => (summaryError ? "—" : n);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Works Reports"
        subtitle="Summary and status of all engineering works"
        back="/works"
      />

      <ReportFilters
        fromDate={sp.fromDate}
        toDate={sp.toDate}
        divisionId={sp.divisionId}
      />

      {summaryError ? (
        <Card title="Summary">
          <RefreshErrorState
            error={toHumanError("load", { area: "works summary" })}
            source={{ area: "works summary" }}
          />
        </Card>
      ) : (
        <StatGrid>
          <StatCard icon="🏗" iconBg="#eef2ff" label="Total Works"  value={stat(summary.totalWorks)} />
          <StatCard icon="🟢" iconBg="#ecfdf3" label="Active Works" value={stat(summary.activeWorks)} />
          <StatCard icon="🔒" iconBg="#f1f5f9" label="Closed Works" value={stat(summary.closedWorks)} />
          {/* GAP-WORKS-REPORTS-05: a residual bucket so Active + Closed + Other
              always reconciles to Total — a proposal in draft/dao_finalized is
              neither active nor closed, so Active + Closed could silently be
              less than Total with no visible explanation. */}
          <StatCard
            icon="🗂"
            iconBg="#fff7ed"
            label="Other / In progress"
            value={stat(Math.max(summary.totalWorks - summary.activeWorks - summary.closedWorks, 0))}
          />
        </StatGrid>
      )}

      <Card title="Status Breakdown">
        {statusError ? (
          <RefreshErrorState
            error={toHumanError("load", { area: "status breakdown" })}
            source={{ area: "status breakdown" }}
          />
        ) : (
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
        )}
      </Card>

      <Card title="Works Register">
        {worksError ? (
          <RefreshErrorState
            error={toHumanError("load", { area: "works register" })}
            source={{ area: "works register" }}
          />
        ) : (
          <>
            {registerMaybeTruncated ? (
              <p
                role="status"
                style={{
                  margin: "0 0 12px",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  background: "var(--warnbg, #fef3c7)",
                  color: "var(--ink)",
                }}
              >
                Showing the first {REGISTER_PAGE_SIZE} works. Narrow the date or
                division filter to see the rest — the CSV export below covers
                only these {REGISTER_PAGE_SIZE} rows.
              </p>
            ) : null}
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
              caption={
                registerMaybeTruncated
                  ? `Works register — first ${REGISTER_PAGE_SIZE} engineering works`
                  : "Works register — engineering works for the selected filters"
              }
              emptyIcon="🏗"
              emptyTitle="No works found"
              emptyMessage="No works match the selected filters."
            />
          </>
        )}
      </Card>
    </div>
  );
}
