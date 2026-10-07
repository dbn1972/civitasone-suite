"use client";

import { useMemo } from "react";
import { Card, DataTable, StatGrid, StatCard, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import type { PreBidConference } from "../../../_data/loaders";

type PreBidRow = {
  id: string;
  tenderId: string;
  tender: string;
  date: string;
  queriesRaised: string;
  responses: string;
  openQueries: string;
  attendees: string;
  status: string;
} & Record<string, unknown>;

/**
 * GAP-PROCUREMENT-PRE-BID-02: the stat tiles are now computed from the SAME
 * useSeededResource rows the table renders, so they can never disagree with
 * the table or show a fabricated row of 0s above an error. On an
 * error-with-no-cache the whole card shows a RefreshErrorState instead of a
 * "No conferences found" empty state.
 *
 * GAP-PROCUREMENT-PRE-BID-03: status comparisons are case-insensitive (so a
 * backend "published"/"completed" counts), the responses tile is named
 * "Responses given", and an "Open queries" tile shows the actionable number.
 */
export function PreBidTable({ conferences, source = "api" }: { conferences: PreBidConference[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<PreBidConference[]>(
    "procurement.pre_bid",
    conferences,
    source,
    (d) => d.length === 0,
  );

  const stats = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase();
    const held = rows.filter((c) => ["completed", "published"].includes(norm(c.status))).length;
    const scheduled = rows.filter((c) => norm(c.status) === "scheduled" || norm(c.status) === "pending").length;
    const totalQueries = rows.reduce((sum, c) => sum + c.queriesRaised, 0);
    const totalResponses = rows.reduce((sum, c) => sum + c.responses, 0);
    const openQueries = rows.reduce(
      (sum, c) => sum + (typeof c.openQueries === "number" ? c.openQueries : Math.max(0, c.queriesRaised - c.responses)),
      0,
    );
    return { held, scheduled, totalQueries, totalResponses, openQueries };
  }, [rows]);

  const errorNoData = provenance === "error-no-data";

  const tableRows = useMemo<PreBidRow[]>(
    () =>
      rows.map((c) => ({
        id: c.id,
        tenderId: c.tenderId,
        tender: c.tender,
        date: formatIndianDate(c.date),
        queriesRaised: String(c.queriesRaised),
        responses: String(c.responses),
        openQueries: String(typeof c.openQueries === "number" ? c.openQueries : Math.max(0, c.queriesRaised - c.responses)),
        attendees: String(c.attendees),
        status: c.status,
      })),
    [rows],
  );

  return (
    <>
      <StatGrid>
        <StatCard icon="🎤" tone="info" label="Conferences Held" value={errorNoData ? null : stats.held} />
        <StatCard icon="❓" tone="neutral" label="Total Queries" value={errorNoData ? null : stats.totalQueries} />
        <StatCard icon="✅" tone="good" label="Responses given" value={errorNoData ? null : stats.totalResponses} />
        <StatCard icon="⏳" tone="warn" label="Open queries" value={errorNoData ? null : stats.openQueries} />
      </StatGrid>

      <Card title="Conference Log">
        <DataSourceBadge
          provenance={provenance ?? "live"}
          cachedAt={cachedAt}
          offline={offline}
          message={errorNoData ? "Couldn't load — showing nothing" : undefined}
        />
        {errorNoData ? (
          <RefreshErrorState error={toHumanError("load", { area: "pre-bid conferences" })} />
        ) : tableRows.length === 0 ? (
          <DataTable<PreBidRow>
            rows={[]}
            columns={[]}
            emptyIcon="🎤"
            emptyTitle="No conferences found"
            emptyMessage="Pre-bid conference records will appear here."
          />
        ) : (
          <DataTable<PreBidRow>
            rows={tableRows}
            rowHref={(row) => (row.tenderId ? `/procurement/tenders/${row.tenderId}` : undefined)}
            identifyingColumnKey="tender"
            sortable
            filterable
            filterPlaceholder="Search tender, status…"
            pageSize={15}
            exportable
            exportFilename="pre-bid-conferences"
            columns={[
              { key: "tender", label: "Tender" },
              { key: "date", label: "Conference Date" },
              { key: "queriesRaised", label: "Queries Raised", align: "center" },
              { key: "responses", label: "Responses", align: "center" },
              { key: "openQueries", label: "Open", align: "center" },
              { key: "attendees", label: "Attendees", align: "center" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
          />
        )}
      </Card>
    </>
  );
}
