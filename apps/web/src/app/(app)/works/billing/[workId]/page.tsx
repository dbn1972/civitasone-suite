import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, DataTable, StatGrid, StatCard } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { hasAnyRole } from "@/lib/auth/roleGuard";
import { BILLING_FINALIZE_ROLES } from "@/lib/auth/workRoles";
import { getBillsForWork, type BillRow } from "../../_data/loaders";
import { billStatusLabel } from "../../_data/format";
import { sumMinor } from "@/lib/money";
import { BillingActions } from "./BillingActions";

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function BillingDetailPage({
  params,
}: {
  params: { workId: string };
}) {
  // GAP-WORKS-BILLING-WORKID-01: consume the shared loader (mapBillRow) instead
  // of a local BillRow/pickData that read r.billNo/r.mode/r.stage — fields the
  // works Bill contract never carries (it is billNumber/billMode/status). The
  // loader maps billNumber→billNo and billMode→mode via modeLabel, and keeps
  // the raw workflow code as rawStatus for BillingActions.
  const billsResult = await getBillsForWork(params.workId);
  const bills: BillRow[] = billsResult.data;

  // GAP-WORKS-BILLING-WORKID-03: server-side role check (never read cookies
  // client-side). Pass a single canFinalize flag to BillingActions; the server
  // billing routes remain the real authority.
  const canFinalize = hasAnyRole(getSessionRoles(), BILLING_FINALIZE_ROLES);

  // ── Stats ──────────────────────────────────────────────────────────────────

  // GAP-WORKS-BILLING-WORKID-05: paise are summed with BigInt (see lib/money
  // sumMinor), never Number() float accumulation.
  const totalGrossMinor = sumMinor(bills.map((b) => b.gross));

  // GAP-WORKS-BILLING-WORKID-02: count against the REAL raw workflow codes.
  // The old page counted "finalized"/"submitted_ifms" which are display
  // buckets that never equal a raw bills.status value, so the cards read 0.
  const finalizedCount = bills.filter((b) => b.rawStatus === "do_finalized").length;
  const submittedCount = bills.filter((b) => b.rawStatus === "submitted").length;

  // ── DataTable rows ─────────────────────────────────────────────────────────
  // Keep gross/netPayable as paise strings — DataTable cellType:"amount" calls
  // formatMoney() which expects minor units. GAP-WORKS-BILLING-WORKID-06: the
  // Status column shows the granular workflow label (billStatusLabel) that
  // matches "Current:" in the finalize stepper; the register keeps the coarse
  // bucket pill. The dead Stage column (fed from a non-existent field) is
  // dropped — the granular Status now carries that information.

  type BillDisplayRow = {
    billNo: string;
    mode: string;
    grossAmountMinor: string;
    netPayableMinor: string;
    status: string;
  };

  const tableRows: BillDisplayRow[] = bills.map((b) => ({
    billNo: b.billNo || "—",
    mode: b.mode || "—",
    grossAmountMinor: b.gross,
    netPayableMinor: b.netPayable,
    status: billStatusLabel(b.rawStatus),
  }));

  const newMbHref = `/works/billing/new-mb?workId=${params.workId}`;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page-main wrap">
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
              className="btn ghost"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Issue MB
            </Link>
            <Link
              href={`/works/billing/measurements/new?workId=${params.workId}`}
              className="btn ghost"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Record measurement
            </Link>
            <Link
              href={`/works/billing/bills/new?workId=${params.workId}`}
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Generate bill
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
          value={formatMoney(totalGrossMinor)}
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
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={tableRows}
          emptyIcon="💰"
          emptyTitle="No bills for this work"
          emptyMessage="Issue a Measurement Book to start billing."
        />
      </Card>

      <BillingActions
        workId={params.workId}
        canFinalize={canFinalize}
        bills={bills.map((b) => ({ id: b.id, billNo: b.billNo, status: b.rawStatus }))}
      />

      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <Link href="/works/billing" className="btn ghost">
          ← Billing register
        </Link>
        <Link href={`/works/billing/bills/new?workId=${params.workId}`} className="btn primary">
          Generate bill →
        </Link>
      </div>
    </div>
  );
}
