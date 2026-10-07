import { notFound } from "next/navigation";
import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, StatusPill, RefreshErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { AssesseeRow } from "../AssesseesTable";
import {
  AssesseeDetailTabs,
  type DcbSummary,
  type DemandRow,
  type BillRow,
  type ReceiptRow,
  type InstalmentPlanRow,
} from "./AssesseeDetailTabs";

async function getAssessee(id: string): Promise<LoaderResult<AssesseeRow | null>> {
  return fetchJson<unknown, AssesseeRow | null>(`/api/v1/revenue/assessees/${encodeURIComponent(id)}`, null, {
    telemetryKey: "revenue.assessees.detail",
    mapResponse: (p) => (p as { data?: AssesseeRow })?.data ?? null,
  });
}

async function getDcb(id: string): Promise<LoaderResult<DcbSummary | null>> {
  return fetchJson<unknown, DcbSummary | null>(`/api/v1/revenue/assessees/${encodeURIComponent(id)}/dcb`, null, {
    telemetryKey: "revenue.assessees.dcb",
    mapResponse: (p) => (p as { data?: DcbSummary })?.data ?? null,
  });
}

async function getDemands(id: string): Promise<LoaderResult<DemandRow[]>> {
  return fetchJson<unknown, DemandRow[]>(`/api/v1/revenue/assessees/${encodeURIComponent(id)}/demands`, [], {
    telemetryKey: "revenue.assessees.demands",
    mapResponse: (p) => {
      const arr = (p as { data?: DemandRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getBills(id: string): Promise<LoaderResult<BillRow[]>> {
  return fetchJson<unknown, BillRow[]>(`/api/v1/revenue/assessees/${encodeURIComponent(id)}/bills`, [], {
    telemetryKey: "revenue.assessees.bills",
    mapResponse: (p) => {
      const arr = (p as { data?: BillRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getReceipts(id: string): Promise<LoaderResult<ReceiptRow[]>> {
  return fetchJson<unknown, ReceiptRow[]>(`/api/v1/revenue/assessees/${encodeURIComponent(id)}/receipts`, [], {
    telemetryKey: "revenue.assessees.receipts",
    mapResponse: (p) => {
      const arr = (p as { data?: ReceiptRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getInstalmentPlans(id: string): Promise<LoaderResult<InstalmentPlanRow[]>> {
  return fetchJson<unknown, InstalmentPlanRow[]>(`/api/v1/revenue/assessees/${encodeURIComponent(id)}/instalments`, [], {
    telemetryKey: "revenue.assessees.instalments",
    mapResponse: (p) => {
      const arr = (p as { data?: InstalmentPlanRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function AssesseeDetailPage({ params }: { params: { id: string } }) {
  const [assesseeResult, dcbResult, demandsResult, billsResult, receiptsResult, instalmentsResult] =
    await Promise.all([
      getAssessee(params.id),
      getDcb(params.id),
      getDemands(params.id),
      getBills(params.id),
      getReceipts(params.id),
      getInstalmentPlans(params.id),
    ]);

  const assessee = assesseeResult.data;

  if (!assessee && assesseeResult.source !== "error") {
    notFound();
  }

  // GAP-REVENUE-ASSESSEES-DETAIL-03: per-section flags so a failed read of one
  // section shows an error+Retry in that tab, not a reassuring "No … recorded".
  const assesseeErrored = assesseeResult.source === "error";
  const dcbErrored = dcbResult.source === "error";
  const demandsErrored = demandsResult.source === "error";
  const billsErrored = billsResult.source === "error";
  const receiptsErrored = receiptsResult.source === "error";
  const instalmentsErrored = instalmentsResult.source === "error";

  const anyError =
    assesseeErrored || dcbErrored || demandsErrored || billsErrored || receiptsErrored || instalmentsErrored;

  // GAP-REVENUE-ASSESSEES-DETAIL-01: deep-link actions so an officer can act on
  // this assessee without re-picking them from a capped select on another lane.
  const q = `?assesseeId=${encodeURIComponent(params.id)}`;
  const ledgerActions = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Link href={`/revenue/bills${q}`} className="btn ghost sm">Generate bill</Link>
      <Link href={`/revenue/receipts${q}`} className="btn ghost sm">Record receipt</Link>
      <Link href={`/revenue/refunds${q}`} className="btn ghost sm">Raise refund</Link>
      <Link href={`/revenue/instalments${q}`} className="btn ghost sm">Instalment plan</Link>
      <Link href={`/revenue/adjustments${q}`} className="btn ghost sm">Adjustment</Link>
      <Link href={`/revenue/write-offs${q}`} className="btn ghost sm">Write-off</Link>
      <Link href={`/revenue/recovery${q}`} className="btn ghost sm">Recovery</Link>
    </div>
  );

  return (
    <div className="page-main wrap">
      <PageHeader
        title={assessee ? assessee.ownerName : "Assessee unavailable"}
        subtitle={assessee ? `${assessee.identifierNo} · ${assessee.assesseeType} · Ward ${assessee.wardNo ?? "—"}` : undefined}
        back="/revenue/assessees"
        backLabel="Assessee Register"
        actions={assessee ? ledgerActions : anyError ? <DataSourceBadge source="error" /> : null}
      />

      {assessee ? (
        <>
          <StatGrid>
            <StatCard
              icon="✅"
              iconBg="#ecfdf3"
              label="Status"
              value={assessee.isActive ? "Active" : "Inactive"}
            />
            <StatCard icon="📄" iconBg="#eff6ff" label="Demands" value={demandsErrored ? null : demandsResult.data.length} />
            <StatCard icon="🧾" iconBg="#fffaeb" label="Bills" value={billsErrored ? null : billsResult.data.length} />
            <StatCard icon="🧮" iconBg="#eef2ff" label="Receipts" value={receiptsErrored ? null : receiptsResult.data.length} />
          </StatGrid>

          {dcbResult.data && (
            <Card title="DCB Snapshot">
              <div className="pad" style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 14 }}>
                <span>Demand: <strong className="mono">{formatMoney(dcbResult.data.totalDemand)}</strong></span>
                <span>Collected: <strong className="mono">{formatMoney(dcbResult.data.totalCollected)}</strong></span>
                <span>
                  Balance:{" "}
                  <strong className="mono">{formatMoney(dcbResult.data.balance)}</strong>{" "}
                  <StatusPill status={Number(dcbResult.data.balance) > 0 ? "pending" : "cleared"} label={Number(dcbResult.data.balance) > 0 ? "Outstanding" : "Cleared"} />
                </span>
              </div>
            </Card>
          )}

          <Card title="Assessee Ledger">
            <AssesseeDetailTabs
              dcb={dcbResult.data}
              dcbErrored={dcbErrored}
              demands={demandsResult.data}
              demandsErrored={demandsErrored}
              bills={billsResult.data}
              billsErrored={billsErrored}
              receipts={receiptsResult.data}
              receiptsErrored={receiptsErrored}
              instalmentPlans={instalmentsResult.data}
              instalmentsErrored={instalmentsErrored}
            />
          </Card>
        </>
      ) : (
        <Card title="Assessee unavailable">
          <RefreshErrorState error={toHumanError("load", { area: "this assessee" })} backHref="/revenue/assessees" />
        </Card>
      )}
    </div>
  );
}
