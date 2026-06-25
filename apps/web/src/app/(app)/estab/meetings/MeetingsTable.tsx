"use client";

import { useState } from "react";
import { DataTable, Segmented } from "@/app/_components/ds";

export type MeetingRow = {
  id: string;
  title: string;
  when: string;
  venue: string;
  attendees: number;
  status: string;
  upcoming: boolean;
};

const SEGMENTS = ["Upcoming", "Past"];

export function MeetingsTable({ rows }: { rows: MeetingRow[] }) {
  const [seg, setSeg] = useState("Upcoming");

  const filtered = rows.filter((r) => (seg === "Upcoming" ? r.upcoming : !r.upcoming));

  return (
    <>
      <div className="card-h">
        <h3>Meetings</h3>
        <Segmented options={SEGMENTS} value={seg} onChange={setSeg} />
      </div>
      <DataTable<MeetingRow>
        columns={[
          { key: "title", label: "Title" },
          { key: "when", label: "When" },
          { key: "venue", label: "Venue" },
          { key: "attendees", label: "Attendees", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={filtered}
        rowLinkKey="id"
        rowLinkPrefix="/estab/meetings/"
        sortable
        filterable
        filterPlaceholder="Filter meetings…"
        pageSize={10}
      />
    </>
  );
}
