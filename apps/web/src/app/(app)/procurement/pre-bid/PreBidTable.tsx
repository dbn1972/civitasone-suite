"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
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
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<PreBidConference[]>(
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

  return (
    <Card title="Conference Log">
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge
        provenance={provenance ?? "live"}
        cachedAt={cachedAt}
        offline={offline}
        message={provenance === "error-no-data" ? "Couldn't load — showing nothing" : undefined}
      />
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
