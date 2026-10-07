import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchJson } from "@/app/_data/apiClient";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, DataTable, StatGrid, StatCard, StatusPill } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { deriveTenderStatus } from "../../_data/format";
import { TenderActions } from "./TenderActions";

// GAP-WORKS-TENDERS-DETAIL-02: web gate mirrors works-service tender routes.ts
// — DAO-finalize is ["dao","works_admin","super_admin"], DO-finalize is
// ["do","works_admin","super_admin"]. The server stays the authority (403s
// others); this only decides whether the UI offers the control.
const DAO_FINALIZE_ROLES = ["dao", "works_admin", "super_admin"];
const DO_FINALIZE_ROLES = ["do", "works_admin", "super_admin"];

// ─── Types ────────────────────────────────────────────────────────────────────

type QuotationRow = {
  id: string;
  tenderId: string;
  contractorId: string | null;
  contractorName: string | null;
  method: string | null;
  quotedAmountMinor: string | null;
  quotedPercentage: string | null;
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
  const [quotationsResult, tenderByIdResult] = await Promise.all([
    fetchJson<unknown, QuotationRow[]>(
      `/api/v1/works/tenders/${params.id}/quotations`,
      [],
      {
        telemetryKey: "works.tenders.quotations",
        mapResponse: (p) => pickData<QuotationRow>(p),
      },
    ),
    // GAP-WORKS-TENDERS-DETAIL-03: resolve the tender directly by id (reachable
    // regardless of list rank) instead of scanning a capped register. A 404
    // from this endpoint maps to notFound(); a transient error does not.
    fetchJson<unknown, TenderListItem | null>(
      `/api/v1/works/tenders/${params.id}`,
      null,
      {
        telemetryKey: "works.tenders.byId",
        mapResponse: (p) => {
          const d = (p && typeof p === "object" && "data" in p ? (p as { data: unknown }).data : p) as TenderListItem | null;
          return d && typeof d === "object" ? d : null;
        },
      },
    ),
  ]);

  const quotations = quotationsResult.data;
  const tender = tenderByIdResult.data;

  // A bogus / non-existent tender id must 404 cleanly rather than render a
  // shell that offers to add quotations and awards to a tender that does not
  // exist. Only 404 when the by-id read actually completed (source !== "error")
  // and returned nothing; a load failure is transient, not a missing record.
  if (tenderByIdResult.source !== "error" && !tender) {
    notFound();
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  const awardedCount = quotations.filter((q) => q.awardId !== null).length;
  const isAwarded = awardedCount > 0;

  // GAP-WORKS-TENDERS-DETAIL-04: lowest bid over ELIGIBLE quotations only,
  // parsed with BigInt (never Number() float math on paise). A quotation is
  // eligible when it carries a valid non-negative integer paise amount and is
  // not withdrawn/rejected and is not a percentage-rate quote (which carries
  // no amount). "—" when none qualify or the fetch errored.
  const INELIGIBLE_STATUSES = new Set(["withdrawn", "rejected", "cancelled"]);
  const lowestBid: string = (() => {
    if (quotationsResult.source === "error") return "—";
    let min: bigint | null = null;
    for (const q of quotations) {
      if (q.status && INELIGIBLE_STATUSES.has(q.status.toLowerCase())) continue;
      if (q.method === "percentage_rate") continue;
      const raw = q.quotedAmountMinor;
      if (raw == null || !/^\d+$/.test(raw)) continue;
      const v = BigInt(raw);
      if (min === null || v < min) min = v;
    }
    return min === null ? "—" : formatMoney(min.toString());
  })();

  // GAP-WORKS-TENDERS-DETAIL-05: an honest status — "Awarded" when an award
  // exists, otherwise the tender's schedule fact (not an invented Open/Closed).
  const statusView = deriveTenderStatus({
    openingDate: null,
    awarded: isAwarded,
    backendStatus: tender?.status ?? null,
  });

  // GAP-WORKS-TENDERS-DETAIL-02: role-gated finalize controls (server-enforced).
  const roles = getSessionRoles();
  const canDaoFinalize = hasAnyRole(roles, DAO_FINALIZE_ROLES);
  const canDoFinalize = hasAnyRole(roles, DO_FINALIZE_ROLES);

  // ── DataTable rows ─────────────────────────────────────────────────────────
  // Keep quotedAmountMinor as a paise string — DataTable cellType:"amount" calls
  // formatMoney() which expects minor units and divides by 100 internally.

  type QuotationDisplayRow = {
    id: string;
    contractor: string;
    quotedAmountMinor: string;
    deviationPercent: string;
    status: string;
    submittedAt: string;
  };

  const tableRows: QuotationDisplayRow[] = quotations.map((q) => ({
    // GAP-WORKS-TENDERS-DETAIL-07: no 8-char UUID prefix in the Ref column —
    // show the contractor (the human-meaningful reference) and drop the id.
    id: q.id,
    // GAP-WORKS-TENDERS-DETAIL-01: show the contractor on every quotation row
    // (the register previously showed none). Viewers get the server-redacted
    // "Bidder (confidential)" placeholder; "—" when truly absent.
    contractor: q.contractorName ?? "—",
    // GAP-WORKS-TENDERS-DETAIL-04: null amount stays "" so DataTable renders
    // "—" (not a fabricated ₹0.00).
    quotedAmountMinor: q.quotedAmountMinor ?? "",
    deviationPercent: q.deviationPercent == null ? "—" : String(q.deviationPercent),
    status: String(q.status ?? "—"),
    submittedAt: formatIndianDate(q.submittedAt),
  }));

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
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
          href="#quotations"
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
          value={statusView.label}
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
        <div id="quotations">
        <Card title="Quotations">
          <DataTable<QuotationDisplayRow>
            columns={[
              { key: "contractor", label: "Contractor" },
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
        </div>
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
              <dd className="v">
                <StatusPill status={statusView.key} label={statusView.label} />
              </dd>
            </div>
            <div className="fld">
              <dt className="l">Work Number</dt>
              <dd className="v">{String(tender.workNumber ?? "—")}</dd>
            </div>
            {/* GAP-WORKS-TENDERS-DETAIL-07: the raw UUID is a technical
                reference, not primary content — kept available but de-emphasised. */}
            <div className="fld">
              <dt className="l">Technical ID</dt>
              <dd className="v" style={{ fontFamily: "var(--mono, monospace)", fontSize: 12, color: "var(--muted)" }}>
                {params.id}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      <TenderActions
        tenderId={params.id}
        workId={tender?.workId ?? null}
        awardId={quotations.find((q) => q.awardId !== null)?.awardId ?? null}
        canDaoFinalize={canDaoFinalize}
        canDoFinalize={canDoFinalize}
        quotations={quotations.map((q) => ({
          id: q.id,
          contractorId: q.contractorId,
          contractorName: q.contractorName,
          quotedAmountMinor: q.quotedAmountMinor,
          method: q.method,
          status: q.status,
        }))}
      />

      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <Link href="/works/tenders" className="btn ghost">
          ← All tenders
        </Link>
        <Link href="/works/tenders/new" className="btn primary">
          + Add pre-tender
        </Link>
      </div>
    </div>
  );
}
