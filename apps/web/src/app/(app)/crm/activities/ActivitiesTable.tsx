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

export function ActivitiesTable({ activities }: { activities: CRMActivityEntry[] }) {
  const [segment, setSegment] = useState<string>("All");
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
