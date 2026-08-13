import { PageHeader, Card, DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import Link from "next/link";

type RawOrder = {
  id: string;
  workNumber?: string;
  description?: string;
  status?: string;
  category?: string;
  estimatedCostMinor?: number | bigint | string;
  createdAt?: string;
} & Record<string, unknown>;

export type OrderRow = {
  id: string;
  workNumber: string;
  description: string;
  statusLabel: string;
  category: string;
  estimatedCost: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft:          "Draft",
  dao_finalized:  "DAO Finalized",
  ts_eligible:    "TS Eligible",
  active:         "Active",
  closed:         "Closed",
};

const STATUS_PRIORITY: Record<string, number> = {
  draft: 1,
  dao_finalized: 2,
  ts_eligible: 3,
  active: 4,
  closed: 5,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function fmtCost(minor: number | bigint | string | undefined): string {
  if (minor == null) return "—";
  const n = typeof minor === "bigint" ? Number(minor) : Number(minor);
  if (Number.isNaN(n)) return "—";
  const rupees = n / 100;
  if (rupees >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(2)} Cr`;
  if (rupees >= 1_00_000)    return `₹${(rupees / 1_00_000).toFixed(2)} L`;
  return `₹${rupees.toLocaleString("en-IN")}`;
}

function mapOrders(payload: unknown): OrderRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!rows) return null;

  return rows
    .flatMap((raw) => {
      if (!isRecord(raw)) return [];
      const row = raw as RawOrder;
      if (typeof row.id !== "string") return [];
      const status = String(row.status ?? "draft");
      return [{
        id: row.id,
        workNumber: String(row.workNumber ?? row.id.slice(0, 8)),
        description: String(row.description ?? "—").slice(0, 80),
        statusLabel: STATUS_LABELS[status] ?? status,
        category: String(row.category ?? "—"),
        estimatedCost: fmtCost(row.estimatedCostMinor as number | undefined),
        _statusOrder: STATUS_PRIORITY[status] ?? 99,
      }];
    })
    .sort((a, b) => (a as { _statusOrder: number })._statusOrder - (b as { _statusOrder: number })._statusOrder);
}

async function getOrders(): Promise<LoaderResult<OrderRow[]>> {
  return fetchJson<unknown, OrderRow[]>("/api/v1/works/work-orders", [], {
    telemetryKey: "works.orders",
    mapResponse: mapOrders,
  });
}

const columns: { key: keyof OrderRow; label: string; cellType?: "status" }[] = [
  { key: "workNumber",    label: "Work No." },
  { key: "description",   label: "Description" },
  { key: "statusLabel",   label: "Status",   cellType: "status" },
  { key: "category",      label: "Category" },
  { key: "estimatedCost", label: "Est. Cost" },
];

export default async function WorkOrdersPage() {
  const { data: orders, source } = await getOrders();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Work Orders"
        subtitle="All civil/infrastructure work proposals in the current lifecycle."
        back="/works"
        backLabel="Works & Billing"
        actions={
          <>
            {source === "error" && <DataSourceBadge source="error" />}
            <Link href="/works/proposals" className="btn secondary">
              New Proposal
            </Link>
          </>
        }
      />

      <Card title={`Work Orders (${orders.length})`}>
        <DataTable<OrderRow>
          columns={columns}
          rows={orders}
          sortable
          filterable
          filterPlaceholder="Filter by work number, description…"
          pageSize={20}
          emptyIcon="📋"
          emptyTitle="No work orders yet"
          emptyMessage="Create a work proposal to begin the lifecycle."
        />
      </Card>
    </main>
  );
}
