"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { BidEvaluation } from "../../../_data/loaders";

type BidRow = {
  id: string;
  tender: string;
  bidder: string;
  technicalScore: string;
  financialScore: string;
  totalScore: string;
  rank: string;
  status: string;
} & Record<string, unknown>;

export function BidEvaluationTable({ evaluations, source = "api" }: { evaluations: BidEvaluation[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<BidEvaluation[]>(
    "procurement.bid_evaluations",
    evaluations,
    source,
    (d) => d.length === 0,
  );

  const tableRows = useMemo<BidRow[]>(
    () =>
      rows.map((e) => ({
        id: e.id,
        tender: e.tender,
        bidder: e.bidder,
        technicalScore: String(e.technicalScore),
        financialScore: String(e.financialScore),
        totalScore: String(e.totalScore),
        rank: String(e.rank),
        status: e.status,
      })),
    [rows],
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="Evaluation Matrix">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
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
            { key: "tender", label: "Tender Ref" },
            { key: "bidder", label: "Bidder" },
            { key: "technicalScore", label: "Technical", align: "right" },
            { key: "financialScore", label: "Financial", align: "right" },
            { key: "totalScore", label: "Total", align: "right" },
            { key: "rank", label: "Rank", align: "center" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}
