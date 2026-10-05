"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CRMActivityEntry } from "@civitasone/types";
import { DataTable, Segmented, EmptyState } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { formatIndianDate, istDatePart, todayIST } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { activityTypeLabel } from "./activityTypes";

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

// GAP-CRM-ACTIVITIES-07: a segment filter that yields zero rows must say which
// segment is empty, not fall back to DataTable's generic "No records found".
const SEGMENT_EMPTY: Record<Segment, { title: string; message: string }> = {
  All: { title: "No activities", message: "No activities match the current view." },
  Today: { title: "Nothing due today", message: "No activities are due today." },
  Overdue: { title: "No overdue activities", message: "Nothing is past its due date — you're caught up." },
};

export function ActivitiesTable({
  activities,
  initialSegment,
  source = "api",
  today,
  heading = "Activities",
  emptyTitle = "No activities yet",
  emptyMessage = "Schedule your first call, meeting, site visit, or correspondence.",
  filterPlaceholder = "Filter activities…",
}: {
  activities: CRMActivityEntry[];
  initialSegment?: string;
  source?: "api" | "error";
  /**
   * Today's IST calendar date ("YYYY-MM-DD"), computed once on the server so
   * the Today segment matches the page's "Due Today" stat and never uses the
   * UTC date (GAP-CRM-ACTIVITIES-03). Falls back to an IST compute if omitted.
   */
  today?: string;
  /** GAP-CRM-ACTIVITIES-08: screen-name copy passed from the server page so
   * this client component stays provider-free while using next-intl text. */
  heading?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  filterPlaceholder?: string;
}) {
  const [segment, setSegment] = useState<string>(resolveSegment(initialSegment));
  const tType = useTranslations("crmActivityTypes");
  const tTable = useTranslations("crmActivitiesTable");
  const todayDate = today ?? todayIST();

  // GAP-CRM-ACTIVITIES-02: an outage leaves `activities` empty, which must not
  // read as "No interactions yet". Show a retry and hide the segment control.
  // ux-001-ok: empty-vs-error guard — this branch only fires when source === "error".
  if (source === "error" && activities.length === 0) {
    return (
      <div className="card">
        <div className="card-h"><h3>{tTable("heading")}</h3></div>
        <RefreshErrorState error={toHumanError("load", { area: tTable("loadArea") })} backHref="/crm" />
      </div>
    );
  }

  const activeSegment = resolveSegment(segment);
  const tableRows: ActivityRow[] = activities
    .filter((a) => {
      if (activeSegment === "Today") return istDatePart(a.dueDate) === todayDate;
      if (activeSegment === "Overdue") return a.status === "overdue";
      return true;
    })
    .map((a) => ({
      id: a.id,
      type: activityTypeLabel(a.type, tType),
      subject: a.subject,
      relatedTo: a.relatedTo ?? "—",
      dueDate: a.dueDate ? formatIndianDate(a.dueDate) : "—",
      owner: a.owner,
      status: a.status,
    }));

  const segmentEmpty = SEGMENT_EMPTY[activeSegment];

  return (
    <div className="card">
      <div className="card-h">
        <h3>{heading}</h3>
        <Segmented options={[...SEGMENTS]} value={segment} onChange={setSegment} />
      </div>
      {activities.length === 0 ? (
        <EmptyState icon="◈" title={emptyTitle} message={emptyMessage} />
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
          filterable
          filterPlaceholder={filterPlaceholder}
          pageSize={25}
          emptyIcon="◈"
          emptyTitle={segmentEmpty.title}
          emptyMessage={segmentEmpty.message}
        />
      )}
    </div>
  );
}
