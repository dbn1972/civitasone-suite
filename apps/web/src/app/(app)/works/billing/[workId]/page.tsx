import Link from "next/link";
import { fetchJson } from "@/app/_data/apiClient";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, DataTable, StatGrid, StatCard } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { BillingActions } from "./BillingActions";

// ─── Types ────────────────────────────────────────────────────────────────────

type BillRow = {
  id: string;
  workId: string;
  billNo: string;
  mode: string;
  grossAmountMinor: string;
  netPayableMinor: string;
  stage: string;
  status: string;
  createdAt: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickData<T>(payload: unknown): T[] {
  if (payload && typeof payload === "object" && "data" in payload) {
    const d = (payload as { data: unknown }).data;
    return Array.isArray(d) ? (d as T[]) : [];
  }
  return Array.isArray(payload) ? (payload as T[]) : [];
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function BillingDetailPage({
  params,
}: {
  params: { workId: string };
}) {
  const billsResult = await fetchJson<unknown, BillRow[]>(
    `/api/v1/works/billing/${params.workId}/bills`,
    [],
    {
      telemetryKey: "works.billing.detail",
      mapResponse: (p) => pickData<BillRow>(p),
    },
  );

  const bills = billsResult.data;

  // ── Stats ──────────────────────────────────────────────────────────────────

  const totalGrossPaise = bills.reduce(
    (sum, b) => sum + Number(String(b.grossAmountMinor ?? 0)),
    0,
  );

  const finalizedCount = bills.filter(
    (b) => b.status === "finalized" || b.status === "do_finalized",
  ).length;

  const submittedCount = bills.filter(
    (b) => b.status === "submitted_ifms",
  ).length;

  // ── DataTable rows ─────────────────────────────────────────────────────────
  // Keep grossAmountMinor / netPayableMinor as paise strings — DataTable
  // cellType:"amount" calls formatMoney() which expects minor units.

  type BillDisplayRow = {
    billNo: string;
    mode: string;
    grossAmountMinor: string;
    netPayableMinor: string;
    stage: string;
    status: string;
  };

  const tableRows: BillDisplayRow[] = bills.map((r) => ({
    billNo: String(r.billNo ?? "—"),
    mode: String(r.mode ?? "—"),
    grossAmountMinor: String(r.grossAmountMinor ?? "0"),
    netPayableMinor: String(r.netPayableMinor ?? "0"),
    stage: String(r.stage ?? "—"),
    status: String(r.status ?? "—"),
  }));

  const newMbHref = `/works/billing/new-mb?workId=${params.workId}`;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Bills & MBs"
        subtitle={`Work ${params.workId.slice(0, 8)}…`}
        back="/works/billing"
        backLabel="Billing Register"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {billsResult.source === "error" && (
              <DataSourceBadge source={billsResult.source} />
            )}
            <Link
              href={newMbHref}
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Issue MB
            </Link>
          </div>
        }
      />

      <StatGrid>
        <StatCard
          icon="💰"
          iconBg="#eff6ff"
          label="Total Bills"
          value={bills.length}
        />
        <StatCard
          icon="📊"
          iconBg="#fffaeb"
          label="Total Gross"
          value={formatMoney(String(Math.round(totalGrossPaise)))}
        />
        <StatCard
          icon="✅"
          iconBg="#ecfdf3"
          label="Finalized"
          value={finalizedCount}
        />
        <StatCard
          icon="📤"
          iconBg="#f0fdf4"
          label="Submitted"
          value={submittedCount}
        />
      </StatGrid>

      <Card title="Bills for this Work">
        <DataTable<BillDisplayRow>
          columns={[
            { key: "billNo", label: "Bill No" },
            { key: "mode", label: "Mode" },
            {
              key: "grossAmountMinor",
              label: "Gross Amount",
              cellType: "amount",
              align: "right",
            },
            {
              key: "netPayableMinor",
              label: "Net Payable",
              cellType: "amount",
              align: "right",
            },
            { key: "stage", label: "Stage" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={tableRows}
          emptyIcon="💰"
          emptyTitle="No bills for this work"
          emptyMessage="Issue a Measurement Book to start billing."
        />
      </Card>

      <BillingActions
        bills={bills.map((b) => ({ id: b.id, billNo: b.billNo, status: b.status }))}
      />

      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <Link href="/works/billing" className="btn ghost">
          ← Billing register
        </Link>
        <Link href={newMbHref} className="btn primary">
          Issue MB →
        </Link>
      </div>
    </main>
  );
}
