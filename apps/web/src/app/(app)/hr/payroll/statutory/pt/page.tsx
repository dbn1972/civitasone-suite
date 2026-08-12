import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
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
        <StatCard icon="🏛️" iconBg="#e6f0ff" label="PT Slabs Configured" value={rows.length} />
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
