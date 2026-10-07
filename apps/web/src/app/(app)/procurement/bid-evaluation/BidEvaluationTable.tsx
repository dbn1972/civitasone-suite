"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, DataTable, EmptyState, ErrorState, StatGrid, StatCard } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";
import type { BidEvaluation } from "../../../_data/loaders";

type BidRow = {
  id: string;
  tender: string;
  tenderId?: string;
  bidder: string;
  technicalScore: string;
  financialScore: string;
  totalScore: string;
  rank: number;
  isL1: boolean;
  isTie: boolean;
  status: string;
} & Record<string, unknown>;

// Statuses that mean the evaluation is finished for that bid. Mirrors
// procurement-service tender bid statuses (consumer.ts): a bid is "under
// evaluation" when it is NOT in one of these terminal states
// (GAP-PROCUREMENT-BID-EVALUATION-03).
const CLOSED_STATUSES = new Set(["awarded", "evaluated", "technically_rejected", "Recommended", "Awarded", "Closed"]);

const scoreFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtScore(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number.isFinite(n) ? scoreFmt.format(n) : "—";
}

export function BidEvaluationTable({ evaluations, source = "api" }: { evaluations: BidEvaluation[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<BidEvaluation[]>(
    "procurement.bid_evaluations",
    evaluations,
    source,
    (d) => d.length === 0,
  );

  // GAP-PROCUREMENT-BID-EVALUATION-01: distinguish a real load failure (nothing
  // to show) from a legitimately empty register.
  const errored = provenance === "error-no-data";

  // GAP-PROCUREMENT-BID-EVALUATION-02/03: every stat derives from the SAME
  // `rows` the table shows.
  const stats = useMemo(() => {
    const tendersUnderEvaluation = new Set(
      rows.filter((e) => !CLOSED_STATUSES.has(e.status)).map((e) => e.tender),
    ).size;
    // Count distinct bidders, not bid-tender pairs (a bidder in two tenders is
    // one bidder).
    const uniqueBidders = new Set(rows.map((e) => e.bidder)).size;
    const recommended = rows.filter((e) => e.status === "Recommended" || e.status === "awarded").length;
    const underReview = rows.filter((e) => !CLOSED_STATUSES.has(e.status)).length;
    return { tendersUnderEvaluation, uniqueBidders, recommended, underReview };
  }, [rows]);

  // GAP-PROCUREMENT-BID-EVALUATION-04: mark L1 (lowest/best rank) and ties.
  const rankCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of rows) m.set(e.rank, (m.get(e.rank) ?? 0) + 1);
    return m;
  }, [rows]);

  const tableRows = useMemo<BidRow[]>(
    () =>
      rows.map((e) => ({
        id: e.id,
        tender: e.tender,
        tenderId: e.tenderId,
        bidder: e.bidder,
        technicalScore: fmtScore(e.technicalScore),
        financialScore: fmtScore(e.financialScore),
        totalScore: fmtScore(e.totalScore),
        rank: e.rank,
        isL1: e.rank === 1,
        isTie: (rankCounts.get(e.rank) ?? 0) > 1,
        status: e.status,
      })),
    [rows, rankCounts],
  );

  return (
    <>
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef2ff" label="Tenders under evaluation" value={errored ? "—" : stats.tendersUnderEvaluation} />
        <StatCard icon="🏢" iconBg="#ecfdf3" label="Bidders" value={errored ? "—" : stats.uniqueBidders} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Recommended / Awarded" value={errored ? "—" : stats.recommended} />
        <StatCard icon="⏳" iconBg="#fce7ee" label="Under Review" value={errored ? "—" : stats.underReview} />
      </StatGrid>

      <Card title="Evaluation Matrix">
        {/* UX-012: single provenance report for the rows below. */}
        <DataSourceBadge
          provenance={provenance ?? "live"}
          cachedAt={cachedAt}
          offline={offline}
          message={errored ? "Couldn't load — showing nothing" : undefined}
        />
        {errored ? (
          // GAP-PROCUREMENT-BID-EVALUATION-01: a failed load with no cache is an
          // ErrorState with retry, NOT an "all clear" EmptyState.
          <ErrorState error={toHumanError("load", { area: "bid evaluations" })} backHref="/procurement/bid-evaluation" />
        ) : tableRows.length === 0 ? (
          <EmptyState icon="📋" title="No evaluations found" message="Bid evaluations will appear here once tenders receive bids." />
        ) : (
          <DataTable<BidRow>
            rows={tableRows}
            sortable
            filterable
            filterPlaceholder="Search tender, bidder…"
            pageSize={15}
            exportable
            exportFilename="bid-evaluations"
            columns={[
              {
                key: "tender",
                label: "Tender Ref",
                render: (row) =>
                  row.tenderId ? (
                    <Link href={`/procurement/tenders/${row.tenderId}`} style={{ color: "#4f46e5" }}>
                      {row.tender}
                    </Link>
                  ) : (
                    <span>{row.tender}</span>
                  ),
              },
              { key: "bidder", label: "Bidder" },
              { key: "technicalScore", label: "Technical", align: "right" },
              { key: "financialScore", label: "Financial", align: "right" },
              { key: "totalScore", label: "Total", align: "right" },
              {
                key: "rank",
                label: "Rank",
                align: "center",
                render: (row) => (
                  <span>
                    {row.rank}
                    {row.isL1 ? <span title="Lowest / best rank" style={{ marginInlineStart: 4, color: "#047857", fontWeight: 600 }}>L1</span> : null}
                    {row.isTie ? <span title="Tied rank" style={{ marginInlineStart: 4, color: "#92400e" }}>(tie)</span> : null}
                  </span>
                ),
              },
              { key: "status", label: "Status", cellType: "status" },
            ]}
          />
        )}
      </Card>
    </>
  );
}
