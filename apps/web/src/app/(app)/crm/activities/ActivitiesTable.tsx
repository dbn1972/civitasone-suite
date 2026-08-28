"use client";

import { useState } from "react";
import type { CRMActivityEntry } from "@civitasone/types";
import { DataTable, Segmented, EmptyState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

type ActivityRow = {
  id: string;
  type: string;
  subject: string;
  relatedTo: string;
  dueDate: string;
  owner: string;
  status: string;
};

const SEGMENTS = ["All", "Today", "Overdue"] as const;
type Segment = (typeof SEGMENTS)[number];

/**
 * Resolve a case-insensitive `?segment=` query value (e.g. from the Control
 * Tower's "Overdue follow-ups" exception drill-down) to one of the real
 * segments, defaulting to "All" for anything else so an unrecognised value
 * never renders a blank/broken toggle state.
 */
function resolveSegment(raw?: string): Segment {
  const match = SEGMENTS.find((s) => s.toLowerCase() === raw?.toLowerCase());
  return match ?? "All";
}

export function ActivitiesTable({
  activities,
  initialSegment,
}: {
  activities: CRMActivityEntry[];
  initialSegment?: string;
}) {
  const [segment, setSegment] = useState<string>(resolveSegment(initialSegment));
  const today = new Date().toISOString().slice(0, 10);

  const tableRows: ActivityRow[] = activities
    .filter((a) => {
      if (segment === "Today") return a.dueDate === today;
      if (segment === "Overdue") return a.status === "overdue";
      return true;
    })
    .map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      relatedTo: a.relatedTo ?? "—",
      dueDate: a.dueDate ? formatIndianDate(a.dueDate) : "—",
      owner: a.owner,
      status: a.status,
    }));

  return (
    <div className="card">
      <div className="card-h">
        <h3>Interactions</h3>
        <Segmented options={[...SEGMENTS]} value={segment} onChange={setSegment} />
      </div>
      {activities.length === 0 ? (
        <EmptyState icon="◈" title="No interactions yet" message="Schedule your first call, meeting, site visit, or correspondence." />
      ) : (
        <DataTable<ActivityRow>
          columns={[
            { key: "type", label: "Type", cellType: "status" },
            { key: "subject", label: "Subject" },
            { key: "relatedTo", label: "Related To" },
            { key: "dueDate", label: "Due Date" },
            { key: "owner", label: "Owner" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={tableRows}
          sortable
        />
      )}
    </div>
  );
}
