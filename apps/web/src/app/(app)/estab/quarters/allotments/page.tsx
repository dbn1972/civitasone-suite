import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { AllotmentsTable, type AllotmentRow } from "./AllotmentsTable";

async function getAllotments(): Promise<LoaderResult<AllotmentRow[]>> {
  return fetchJson<unknown, AllotmentRow[]>("/api/v1/estab/quarter-allotments", [], {
    telemetryKey: "estab.quarters.allotments.list",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: AllotmentRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function QuarterAllotmentsPage() {
  const { data: allotments, source } = await getAllotments();
  const errored = source === "error";

  const applied = allotments.filter((a) => a.status === "applied" || a.status === "waitlisted").length;
  const allotted = allotments.filter((a) => a.status === "allotted").length;
  const occupied = allotments.filter((a) => a.status === "occupied").length;
  const vacating = allotments.filter((a) => a.status === "vacation_notice").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Quarter Allotments"
        subtitle="Applications, maker-checker allotment decisions, and the occupy / vacation-notice / vacate lifecycle."
        back="/estab/quarters"
        actions={errored ? <DataSourceBadge source="error" /> : null}
      />

      {/* Counts below are computed from `allotments`, which is [] whenever the fetch
          errored — never render them as authoritative facts in that case. */}
      {errored && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📝" iconBg="#fffaeb" label="Applied / Waitlisted" value={errored ? "—" : applied.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Allotted" value={errored ? "—" : allotted.toLocaleString("en-IN")} />
        <StatCard icon="🏠" iconBg="#eef2ff" label="Occupied" value={errored ? "—" : occupied.toLocaleString("en-IN")} />
        <StatCard icon="🚚" iconBg="#fef2f2" label="Under Vacation Notice" value={errored ? "—" : vacating.toLocaleString("en-IN")} />
      </StatGrid>

      <Card title="Allotments">
        {errored && allotments.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <AllotmentsTable allotments={allotments} />
        )}
      </Card>
    </main>
  );
}
