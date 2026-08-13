import { PageHeader, Card, DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type RawContractor = {
  id: string;
  name?: string;
  registrationNo?: string;
  pan?: string;
  phone?: string;
  performanceRating?: number | null;
  ratingCount?: number;
  active?: boolean;
} & Record<string, unknown>;

export type ContractorRow = {
  id: string;
  name: string;
  registrationNo: string;
  pan: string;
  phone: string;
  rating: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapContractors(payload: unknown): ContractorRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!rows) return null;
  return rows.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const row = raw as RawContractor;
    if (typeof row.id !== "string") return [];
    const rating = row.performanceRating != null ? `${row.performanceRating}/5 (${row.ratingCount ?? 0})` : "Not rated";
    return [{
      id: row.id,
      name: String(row.name ?? "—"),
      registrationNo: String(row.registrationNo ?? "—"),
      pan: String(row.pan ?? "—"),
      phone: String(row.phone ?? "—"),
      rating,
    }];
  });
}

async function getContractors(): Promise<LoaderResult<ContractorRow[]>> {
  return fetchJson<unknown, ContractorRow[]>("/api/v1/works/contractors", [], {
    telemetryKey: "works.contractors",
    mapResponse: mapContractors,
  });
}

const columns: { key: keyof ContractorRow; label: string }[] = [
  { key: "name",           label: "Name" },
  { key: "registrationNo", label: "Reg. No." },
  { key: "pan",            label: "PAN" },
  { key: "phone",          label: "Phone" },
  { key: "rating",         label: "Performance Rating" },
];

export default async function ContractorsPage() {
  const { data: contractors, source } = await getContractors();
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Contractors"
        subtitle="Registered contractors available for tender quotations."
        back="/works"
        backLabel="Works & Billing"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />
      <Card title={"Contractors (" + contractors.length + ")"}>
        <DataTable<ContractorRow>
          columns={columns}
          rows={contractors}
          sortable
          filterable
          filterPlaceholder="Filter by name, registration…"
          pageSize={20}
          emptyIcon="🏢"
          emptyTitle="No contractors registered"
          emptyMessage="Add contractors to enable quotation and award workflows."
        />
      </Card>
    </main>
  );
}
