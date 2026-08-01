import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { QuartersTable, type QuarterRow } from "./QuartersTable";
import { QuarterCreateForm } from "./QuarterCreateForm";

async function getQuarters(): Promise<LoaderResult<QuarterRow[]>> {
  return fetchJson<unknown, QuarterRow[]>("/api/v1/estab/quarters", [], {
    telemetryKey: "estab.quarters.list",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: QuarterRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function QuartersPage() {
  const { data: quarters, source } = await getQuarters();
  const errored = source === "error";

  const total = quarters.length;
  const vacant = quarters.filter((q) => q.status === "vacant").length;
  const allotted = quarters.filter((q) => q.status === "allotted").length;
  const occupied = quarters.filter((q) => q.status === "occupied").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Residential Quarters"
        subtitle="Quarters inventory and the allotment lifecycle — apply, allot, occupy and vacate."
        back="/estab"
        actions={
          <>
            {errored && <DataSourceBadge source="error" />}
            <Link href="/estab/quarters/allotments" className="btn ghost" style={{ minHeight: 44 }}>
              Allotment workflow
            </Link>
          </>
        }
      />

      {/* Counts below are computed from `quarters`, which is [] whenever the fetch
          errored — never render them as authoritative facts in that case. */}
      {errored && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🏘️" iconBg="#eff6ff" label="Total Quarters" value={errored ? "—" : total.toLocaleString("en-IN")} />
        <StatCard icon="🟢" iconBg="#ecfdf3" label="Vacant" value={errored ? "—" : vacant.toLocaleString("en-IN")} />
        <StatCard icon="📋" iconBg="#fffaeb" label="Allotted" value={errored ? "—" : allotted.toLocaleString("en-IN")} />
        <StatCard icon="🏠" iconBg="#eef2ff" label="Occupied" value={errored ? "—" : occupied.toLocaleString("en-IN")} />
      </StatGrid>

      <QuarterCreateForm />

      <Card title="Quarters">
        {errored && quarters.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <QuartersTable quarters={quarters} />
        )}
      </Card>
    </main>
  );
}
