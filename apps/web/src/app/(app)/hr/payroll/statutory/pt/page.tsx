import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { PtSlabForm } from "./PtSlabForm";

type PtSlabRow = {
  state_code: string;
  slab_from_minor: number | string;
  slab_to_minor: number | string;
  pt_amount_minor: number | string;
} & Record<string, unknown>;

type StateRulesResponse = { ptSlabs?: PtSlabRow[]; lwfConfig?: unknown[] };

async function getData(): Promise<LoaderResult<PtSlabRow[]>> {
  return fetchJson<StateRulesResponse, PtSlabRow[]>("/api/v1/payroll/statutory/state-rules", [], {
    telemetryKey: "payroll.statutory.pt",
    mapResponse: (p) => (Array.isArray(p?.ptSlabs) ? p.ptSlabs! : null),
  });
}

export default async function ProfessionalTaxPage() {
  const { data: rows, source } = await getData();

  const statesCovered = new Set(rows.map((r) => r.state_code).filter(Boolean)).size;
  const maxPtMinor = rows.length > 0 ? Math.max(...rows.map((r) => Number(r.pt_amount_minor || 0))) : 0;
  const avgPtMinor = rows.length > 0 ? rows.reduce((s, r) => s + Number(r.pt_amount_minor || 0), 0) / rows.length : 0;

  const columns: { key: keyof PtSlabRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "state_code", label: "State" },
    { key: "slab_from_minor", label: "Slab From", align: "right", cellType: "amount" },
    { key: "slab_to_minor", label: "Slab To", align: "right", cellType: "amount" },
    { key: "pt_amount_minor", label: "PT Amount", align: "right", cellType: "amount" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Professional Tax"
        subtitle="State-wise professional tax slabs (monthly deduction by gross-salary band)."
        back="/hr/payroll/statutory"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏛️" iconBg="var(--infobg)" label="PT Slabs Configured" value={rows.length} />
        <StatCard icon="🗺️" iconBg="var(--goodbg)" label="States Covered" value={statesCovered} />
        <StatCard icon="📈" iconBg="var(--warnbg)" label="Highest PT Amount" value={formatMoney(maxPtMinor)} />
        <StatCard icon="📊" iconBg="var(--goodbg)" label="Avg PT per Slab" value={formatMoney(Math.round(avgPtMinor))} />
      </StatGrid>

      <PtSlabForm />

      <Card title="Professional Tax Slabs">
        <DataTable<PtSlabRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by state…"
          pageSize={15}
          emptyIcon="🏛️"
          emptyTitle="No PT slabs configured"
          emptyMessage="Add a state's professional tax slab using the form above."
        />
      </Card>
    </main>
  );
}
