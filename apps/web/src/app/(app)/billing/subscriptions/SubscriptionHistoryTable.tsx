"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTable, Segmented } from "@/app/_components/ds";
import { formatShortId } from "@/lib/formatters";

/**
 * GAP-BILLING-SUBSCRIPTIONS-03: the tenant's subscription history (active and past) as a sortable
 * table with an Active / Past / All status filter. Rows come from GET /v1/billing/subscriptions/history.
 */
export interface SubscriptionHistoryRow {
  id: string;
  plan: string;
  planName: string | null;
  status: string;
  startDate: string | null;
  renewalDate: string | null;
  amountMinor: string | null;
  currency: string | null;
}

type Filter = "all" | "active" | "past";

// Past = cancelled subscriptions; Active = the current one (trial, active, past due or suspended).
const PAST_STATUSES = new Set(["cancelled"]);

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "past", label: "Past" },
];

export function matchesFilter(status: string, filter: Filter): boolean {
  if (filter === "all") return true;
  return filter === "past" ? PAST_STATUSES.has(status) : !PAST_STATUSES.has(status);
}

interface TableRow extends Record<string, unknown> {
  id: string;
  shortId: string;
  planLabel: string;
  status: string;
  startDate: string | null;
  renewalDate: string | null;
  amountMinor: string | null;
}

export function SubscriptionHistoryTable({ rows }: { rows: SubscriptionHistoryRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const tableRows = useMemo<TableRow[]>(
    () =>
      rows
        .filter((r) => matchesFilter(r.status, filter))
        .map((r) => ({
          id: r.id,
          shortId: formatShortId(r.id),
          planLabel: r.planName ?? formatShortId(r.plan),
          status: r.status,
          startDate: r.startDate,
          renewalDate: r.renewalDate,
          amountMinor: r.amountMinor,
        })),
    [rows, filter],
  );
  const planIdByRow = useMemo(() => new Map(rows.map((r) => [r.id, r.plan])), [rows]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Segmented options={FILTER_OPTIONS} value={filter} onChange={(v) => setFilter(v as Filter)} />
      <DataTable<TableRow>
        columns={[
          { key: "shortId", label: "Subscription" },
          {
            key: "planLabel",
            label: "Plan",
            render: (row) => {
              const planId = planIdByRow.get(row.id);
              return planId ? <Link href={`/billing/plans/${planId}`}>{row.planLabel}</Link> : row.planLabel;
            },
          },
          { key: "status", label: "Status", cellType: "status" },
          { key: "startDate", label: "Start", cellType: "date" },
          { key: "renewalDate", label: "Renewal", cellType: "date" },
          { key: "amountMinor", label: "Plan price", align: "right", cellType: "money" },
        ]}
        rows={tableRows}
        identifyingColumnKey="shortId"
        sortable
        pageSize={15}
        emptyIcon="📦"
        emptyTitle={filter === "all" ? "No subscriptions yet" : "No subscriptions match this filter"}
        emptyMessage={filter === "all" ? "Subscriptions for this tenant will be listed here." : "Choose another filter to see the rest."}
      />
    </div>
  );
}
