"use client";

import { useMemo, useState } from "react";
import { DataTable, Segmented, StatusPill } from "@/app/_components/ds";
import { OfficerName } from "../files/[id]/OfficerName";

export type InboxRow = {
  id: string;
  fileNo: string;
  subject: string;
  status: string;
  statusRaw: string;
  currentHolder?: string;
  dueDate?: string;
};

const SEGMENTS = ["Active", "All"];

const MS_PER_DAY = 1000 * 60 * 60 * 24;

type Sla = { label: string; tone: "good" | "warn" | "bad" | "mut" };

function computeSla(dueDate?: string): Sla {
  if (!dueDate) return { label: "—", tone: "mut" };
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return { label: "—", tone: "mut" };
  // Compare by calendar day so "today" reads as 0 days, not a few hours.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((due.getTime() - startOfToday.getTime()) / MS_PER_DAY);
  if (daysLeft < 0) return { label: `overdue ${Math.abs(daysLeft)}d`, tone: "bad" };
  if (daysLeft <= 3) return { label: `${daysLeft}d left`, tone: "warn" };
  return { label: `${daysLeft}d left`, tone: "good" };
}

const TONE_CLASS: Record<Sla["tone"], string> = {
  good: "good",
  warn: "warn",
  bad: "bad",
  mut: "mut",
};

export function InboxPanel({ rows }: { rows: InboxRow[] }) {
  const [seg, setSeg] = useState("Active");

  // Active files first, then everything else (X12 grouping cue).
  const ordered = useMemo(() => {
    const isActive = (r: InboxRow) => r.statusRaw === "active";
    return [...rows].sort((a, b) => Number(isActive(b)) - Number(isActive(a)));
  }, [rows]);

  const filtered = useMemo(
    () => (seg === "Active" ? ordered.filter((r) => r.statusRaw === "active") : ordered),
    [ordered, seg],
  );

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
              const sla = computeSla(r.dueDate);
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
