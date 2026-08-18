import Link from "next/link";
import { fetchJson } from "@/app/_data/apiClient";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, DataTable, StatGrid, StatCard } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

// ─── Types ────────────────────────────────────────────────────────────────────

type QuotationRow = {
  id: string;
  tenderId: string;
  contractorId: string | null;
  quotedAmountMinor: string;
  deviationPercent: number | null;
  status: string;
  submittedAt: string | null;
  awardId: string | null;
};

type TenderListItem = {
  id: string;
  workId: string | null;
  workNumber: string | null;
  tenderType: string | null;
  tenderCategory: string | null;
  status: string | null;
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

export default async function TenderDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [quotationsResult, tendersResult] = await Promise.all([
    fetchJson<unknown, QuotationRow[]>(
      `/api/v1/works/tenders/${params.id}/quotations`,
      [],
      {
        telemetryKey: "works.tenders.quotations",
        mapResponse: (p) => pickData<QuotationRow>(p),
      },
    ),
    fetchJson<unknown, TenderListItem[]>(
      `/api/v1/works/tenders?pageSize=200`,
      [],
      {
        telemetryKey: "works.tenders.list",
        mapResponse: (p) => pickData<TenderListItem>(p),
      },
    ),
  ]);

  const quotations = quotationsResult.data;
  const tenders = tendersResult.data;
  const tender = tenders.find((t) => t.id === params.id);

  // ── Stats ──────────────────────────────────────────────────────────────────

  const awardedCount = quotations.filter((q) => q.awardId !== null).length;

  const lowestBid: string = (() => {
    if (quotations.length === 0) return "—";
    const minPaise = quotations.reduce((min, q) => {
      const v = Number(q.quotedAmountMinor);
      return v < min ? v : min;
    }, Number(quotations[0].quotedAmountMinor));
    return formatMoney(String(Math.round(minPaise)));
  })();

  // ── DataTable rows ─────────────────────────────────────────────────────────
  // Keep quotedAmountMinor as a paise string — DataTable cellType:"amount" calls
  // formatMoney() which expects minor units and divides by 100 internally.

  type QuotationDisplayRow = {
    id: string;
    quotedAmountMinor: string;
    deviationPercent: string;
    status: string;
    submittedAt: string;
  };

  const tableRows: QuotationDisplayRow[] = quotations.map((q) => ({
    id: q.id.slice(0, 8),
    quotedAmountMinor: String(q.quotedAmountMinor ?? "0"),
    deviationPercent: String(q.deviationPercent ?? "—"),
    status: String(q.status ?? "—"),
    submittedAt: formatIndianDate(q.submittedAt),
  }));

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={
          tender?.workNumber
            ? `Tender — ${tender.workNumber}`
            : `Tender ${params.id.slice(0, 8)}…`
        }
        subtitle={String(tender?.tenderType ?? "Pre-tender")}
        back="/works/tenders"
        backLabel="Tenders"
        actions={
          quotationsResult.source === "error" ? (
            <DataSourceBadge source={quotationsResult.source} />
          ) : undefined
        }
      />

      <StatGrid>
        <StatCard
          icon="📝"
          iconBg="#eff6ff"
          label="Total Quotations"
          value={quotations.length}
        />
        <StatCard
          icon="🏆"
          iconBg="#f0fdf4"
          label="Awarded"
          value={awardedCount}
        />
        <StatCard
          icon="💰"
          iconBg="#fffaeb"
          label="Lowest Bid"
          value={lowestBid}
        />
        <StatCard
          icon="📋"
          iconBg="#eef2ff"
          label="Tender Status"
          value={String(tender?.status ?? "—")}
        />
      </StatGrid>

      {quotationsResult.source === "error" ? (
        <div className="card">
          <div className="card-h">
            <h3>Quotations</h3>
          </div>
          <div className="pad" style={{ padding: 24 }}>
            Quotations could not be loaded. The tender may still exist — try
            refreshing.
          </div>
        </div>
      ) : (
        <Card title="Quotations">
          <DataTable<QuotationDisplayRow>
            columns={[
              { key: "id", label: "Ref" },
              {
                key: "quotedAmountMinor",
                label: "Quoted Amount",
                cellType: "amount",
                align: "right",
              },
              { key: "deviationPercent", label: "Deviation %", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "submittedAt", label: "Submitted" },
            ]}
            rows={tableRows}
            emptyIcon="📋"
            emptyTitle="No quotations yet"
            emptyMessage="Quotations will appear once the tender is open for bidding."
          />
        </Card>
      )}

      {tender && (
        <Card title="Tender Details" padding>
          <dl className="fields">
            <div className="fld">
              <dt className="l">Tender Type</dt>
              <dd className="v">{String(tender.tenderType ?? "—")}</dd>
            </div>
            <div className="fld">
              <dt className="l">Category</dt>
              <dd className="v">{String(tender.tenderCategory ?? "—")}</dd>
            </div>
            <div className="fld">
              <dt className="l">Status</dt>
              <dd className="v">{String(tender.status ?? "—")}</dd>
            </div>
            <div className="fld">
              <dt className="l">Work Number</dt>
              <dd className="v">{String(tender.workNumber ?? "—")}</dd>
            </div>
            <div className="fld">
              <dt className="l">Tender ID</dt>
              <dd className="v">{params.id}</dd>
            </div>
          </dl>
        </Card>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <Link href="/works/tenders" className="btn ghost">
          ← All tenders
        </Link>
        <Link href="/works/tenders/new" className="btn primary">
          + Add pre-tender
        </Link>
      </div>
    </main>
  );
}
