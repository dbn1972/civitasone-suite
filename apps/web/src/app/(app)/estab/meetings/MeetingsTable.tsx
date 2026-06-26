"use client";

import { useState } from "react";
import { DataTable, Segmented } from "@/app/_components/ds";

export type MeetingRow = {
  id: string;
  meetingNo: string;
  title: string;
  when: string;
  venue: string;
  attendees: number;
  status: string;
  upcoming: boolean;
};

const SEGMENTS = ["All", "Upcoming", "Past"];

export function MeetingsTable({ rows }: { rows: MeetingRow[] }) {
  const [seg, setSeg] = useState("All");

  const filtered = rows.filter((r) => {
    if (seg === "Upcoming") return r.upcoming;
    if (seg === "Past") return !r.upcoming;
    return true;
  });

  return (
    <>
      <div className="card-h">
        <h3>Meetings</h3>
        <Segmented options={SEGMENTS} value={seg} onChange={setSeg} />
      </div>
      <DataTable<MeetingRow>
        columns={[
          { key: "meetingNo", label: "Meeting No" },
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
