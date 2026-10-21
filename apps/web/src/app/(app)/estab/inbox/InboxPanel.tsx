"use client";

import { useMemo, useState } from "react";
import { DataTable, Segmented, StatusPill } from "@/app/_components/ds";
import { OfficerName } from "../files/[id]/OfficerName";
import { computeSla, isClosedStatus, type Sla } from "@/lib/estab/sla";

export type InboxRow = {
  id: string;
  fileNo: string;
  subject: string;
  status: string;
  statusRaw: string;
  currentHolder?: string;
  dueDate?: string;
};

const SEGMENTS = ["Active", "Pending", "All"];

const TONE_CLASS: Record<Sla["tone"], string> = {
  good: "good",
  warn: "warn",
  bad: "bad",
  mut: "mut",
};

export function InboxPanel({ rows }: { rows: InboxRow[] }) {
  const [seg, setSeg] = useState("Active");

  // Active then pending then everything else (grouping cue).
  const ordered = useMemo(() => {
    const rank = (r: InboxRow) =>
      isClosedStatus(r.statusRaw) ? 2 : r.statusRaw === "pending" ? 1 : 0;
    return [...rows].sort((a, b) => rank(a) - rank(b));
  }, [rows]);

  // Default "Active" view includes in-transit "pending" files so an officer
  // with files awaiting receipt isn't shown an empty desk (GAP-ESTAB-INBOX-05).
  const filtered = useMemo(() => {
    if (seg === "Pending") return ordered.filter((r) => r.statusRaw === "pending");
    if (seg === "Active") return ordered.filter((r) => !isClosedStatus(r.statusRaw));
    return ordered;
  }, [ordered, seg]);

  return (
    <>
      <div className="card-h">
        <h3>Files on my desk</h3>
        <Segmented options={SEGMENTS} value={seg} onChange={setSeg} />
      </div>
      <DataTable<InboxRow>
        columns={[
          { key: "fileNo", label: "File No" },
          { key: "subject", label: "Subject" },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.statusRaw} label={r.status} /> },
          {
            key: "currentHolder",
            label: "Currently with",
            render: (r) => (r.currentHolder ? <OfficerName id={r.currentHolder} /> : <>—</>),
          },
          {
            key: "dueDate",
            label: "SLA",
            render: (r) => {
              // A finished file has no SLA: show it neutral, never as overdue (lib/estab/sla.ts).
              const sla: Sla = isClosedStatus(r.statusRaw) ? { label: "—", tone: "mut" } : computeSla(r.dueDate);
              return <span className={`pill ${TONE_CLASS[sla.tone]}`}>{sla.label}</span>;
            },
          },
        ]}
        rows={filtered}
        rowLinkKey="id"
        rowLinkPrefix="/estab/files/"
        sortable
        filterable
        filterPlaceholder="Filter my desk…"
        pageSize={10}
        emptyIcon="🗂️"
        emptyTitle="Nothing on your desk"
        emptyMessage="No eOffice files are pending with you right now."
      />
    </>
  );
}
