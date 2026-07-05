"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { PreBidConference } from "../../../_data/loaders";

type PreBidRow = {
  id: string;
  tender: string;
  date: string;
  queriesRaised: string;
  responses: string;
  attendees: string;
  status: string;
} & Record<string, unknown>;

export function PreBidTable({ conferences, source = "api" }: { conferences: PreBidConference[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<PreBidConference[]>(
    "procurement.pre_bid",
    conferences,
    source,
    (d) => d.length === 0,
  );

  const tableRows = useMemo<PreBidRow[]>(
    () =>
      rows.map((c) => ({
        id: c.id,
        tender: c.tender,
        date: c.date,
        queriesRaised: String(c.queriesRaised),
        responses: String(c.responses),
        attendees: String(c.attendees),
        status: c.status,
      })),
    [rows],
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="Conference Log">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
        <EmptyState icon="🎤" title="No conferences found" message="Pre-bid conference records will appear here." />
      ) : (
        <DataTable<PreBidRow>
          rows={tableRows}
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
            { key: "attendees", label: "Attendees", align: "center" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}
