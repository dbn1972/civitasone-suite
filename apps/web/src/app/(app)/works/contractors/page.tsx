import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "@/app/_components/ds";
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
  activeStatus: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function formatRating(
  perf: number | null | undefined,
  count: number | undefined,
): string {
  if (perf == null) return "Not rated";
  return `${perf}/5 (${count ?? 0} reviews)`;
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
    return [
      {
        id: row.id,
        name: String(row.name ?? "—"),
        registrationNo: String(row.registrationNo ?? "—"),
        pan: String(row.pan ?? "—"),
        phone: String(row.phone ?? "—"),
        rating: formatRating(row.performanceRating, row.ratingCount),
        activeStatus: row.active !== false ? "Active" : "Inactive",
      },
    ];
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
  { key: "activeStatus",   label: "Status" },
];

export default async function ContractorsPage() {
  const { data: contractors, source } = await getContractors();

  const total      = contractors.length;
  const activeCount  = contractors.filter((c) => c.activeStatus === "Active").length;
  const ratedCount   = contractors.filter((c) => c.rating !== "Not rated").length;
  const unratedCount = total - ratedCount;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Contractors"
        subtitle="Registered contractors available for tender quotations."
        back="/works"
        backLabel="Works & Billing"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {source === "error" && <DataSourceBadge source="error" />}
            <Link
              href="/works/contractors/new"
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Register contractor
            </Link>
          </div>
        }
      />

      <StatGrid>
        <StatCard icon="🏢" iconBg="var(--infobg, #eff6ff)"  label="Total"    value={total} />
        <StatCard icon="✅" iconBg="var(--goodbg, #ecfdf3)"  label="Active"   value={activeCount} />
        <StatCard icon="⭐" iconBg="var(--warnbg, #fef3c7)"  label="Rated"    value={ratedCount} />
        <StatCard icon="🔲" iconBg="var(--panel, #f1f5f9)"   label="Unrated"  value={unratedCount} />
      </StatGrid>

      <Card title={`Contractors (${total})`}>
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
