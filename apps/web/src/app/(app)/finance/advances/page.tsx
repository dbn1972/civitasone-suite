import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { AdvanceSlideOver } from "./AdvanceSlideOver";

/**
 * Finance AdvancesPage — GFR 2017 Rule 290
 * Every advance (TA / Medical / Festival / HBA) must show the sanctioning
 * authority. Approver column is mandatory under Rule 290.
 */

type AdvanceType = "TA" | "Medical" | "Festival" | "HBA";
type AdvanceStatus =
  | "Pending Sanction"
  | "Sanctioned"
  | "Recovery in progress"
  | "Closed";

type ApiAdvance = {
  id: string;
  employee?: { name?: string; employeeNo?: string };
  advanceType: AdvanceType;
  amountMinor: number;
  purpose?: string;
  sanctionedBy?: string;
  recoveryMonths?: number;
  recoveredMinor?: number;
  status: AdvanceStatus;
  sanctionDate?: string;
  created_at?: string;
};

type Row = {
  id: string;
  employee: string;
  advanceType: string;
  amount: string;
  sanctionedBy: string;
  recoveredAmt: string;
  status: AdvanceStatus;
} & Record<string, unknown>;

function formatINR(minor: number | undefined): string {
  if (minor == null) return "—";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

function mapRows(rows: ApiAdvance[]): Row[] {
  return rows.map((a) => ({
    id: a.id,
    employee: a.employee?.name
      ? `${a.employee.name} (${a.employee.employeeNo ?? "—"})`
      : "—",
    advanceType: a.advanceType ?? "—",
    amount: formatINR(a.amountMinor),
    sanctionedBy: a.sanctionedBy ?? "—",
    recoveredAmt: formatINR(a.recoveredMinor),
    status: a.status ?? "Pending Sanction",
  }));
}

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/finance/advances", [], {
    telemetryKey: "finance.advances",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiAdvance[] })?.data;
      return Array.isArray(arr) ? mapRows(arr as ApiAdvance[]) : null;
    },
  });
}

const COLUMNS: {
  key: keyof Row & string;
  label: string;
  cellType?: "status";
}[] = [
  { key: "employee", label: "Employee" },
  { key: "advanceType", label: "Advance Type" },
  { key: "amount", label: "Amount" },
  { key: "sanctionedBy", label: "Sanctioned By (GFR R.290)" },
  { key: "recoveredAmt", label: "Recovered" },
  { key: "status", label: "Status", cellType: "status" },
];

export default async function AdvancesPage() {
  const { data: items, source } = await getData();

  const pendingSanction = items.filter(
    (i) => i.status === "Pending Sanction"
  ).length;
  const sanctioned = items.filter(
    (i) => i.status === "Sanctioned" || i.status === "Recovery in progress"
  ).length;
  const closed = items.filter((i) => i.status === "Closed").length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Advances"
        subtitle="TA, Medical, Festival and HBA advances — GFR 2017 Rule 290. Every advance requires sanctioning authority signature."
        back="/finance"
        actions={<AdvanceSlideOver />}
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total Advances" value={items.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending Sanction" value={pendingSanction} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Sanctioned / In Recovery" value={sanctioned} />
        <StatCard icon="🔒" iconBg="#f5f5f5" label="Closed" value={closed} />
      </StatGrid>

      <Card title="Advance Register">
        {items.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No advances on record"
            message="Advances sanctioned under GFR 2017 Rule 290 appear here. Raise a new advance using the button above."
            action={<AdvanceSlideOver />}
          />
        ) : (
          <DataTable<Row>
            columns={COLUMNS}
            rows={items}
            sortable
            filterable
            filterPlaceholder="Filter by employee, type or status…"
            pageSize={20}
            emptyIcon="📋"
            emptyTitle="No matching advances"
            emptyMessage="Adjust the filter to find the advance."
          />
        )}
      </Card>
    </div>
  );
}
