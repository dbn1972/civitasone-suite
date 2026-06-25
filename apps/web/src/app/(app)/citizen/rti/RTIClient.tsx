"use client";
import { useState } from "react";
import { DataTable, Segmented, EmptyState } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

interface RTIApplication {
  id: string;
  rtiNo: string;
  applicantName: string;
  subject: string;
  publicAuthority?: string | null;
  filedDate?: string | null;
  deadlineDate?: string | null;
  status: string;
  isFirstAppeal: boolean;
}

interface Props {
  rtis: RTIApplication[];
  today: string;
}

const SEG_OPTIONS = ["All", "Due", "Overdue"];

/** RTI Act 2005 §7: 30-day statutory clock. Returns whole days remaining
 * (negative = days past the deadline). null when no deadline / already closed. */
function daysRemaining(deadline: string | null | undefined, today: string): number | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  const t = new Date(today);
  if (isNaN(d.getTime()) || isNaN(t.getTime())) return null;
  return Math.round((d.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
}

const CLOSED = new Set(["replied", "closed", "appeal"]);

interface Row extends Record<string, unknown> {
  id: string;
  rtiNo: string;
  applicantName: string;
  subject: string;
  publicAuthority: string;
  filedDate: string;
  deadlineDate: string;
  daysLeft: number | null;
  closed: boolean;
  status: string;
  firstAppeal: string;
}

/** Statutory clock cell — colour AND text (never colour alone, WCAG 1.4.1). */
function clockCell(row: Row) {
  if (row.closed) {
    return <span style={{ color: "var(--muted)" }}>Closed</span>;
  }
  const n = row.daysLeft;
  if (n === null) return <span style={{ color: "var(--muted)" }}>—</span>;
  if (n < 0) {
    return <span style={{ color: "#b42318", fontWeight: 600 }}>{`Overdue by ${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"}`}</span>;
  }
  if (n === 0) {
    return <span style={{ color: "#b42318", fontWeight: 600 }}>Due today</span>;
  }
  const color = n <= 5 ? "#b54708" : "#067647";
  return <span style={{ color, fontWeight: n <= 5 ? 600 : 400 }}>{`${n} day${n === 1 ? "" : "s"} left`}</span>;
}

const COLUMNS = [
  { key: "rtiNo" as const, label: "RTI No" },
  { key: "applicantName" as const, label: "Applicant" },
  { key: "subject" as const, label: "Subject" },
  { key: "publicAuthority" as const, label: "Public Authority" },
  { key: "filedDate" as const, label: "Filed" },
  { key: "deadlineDate" as const, label: "Deadline" },
  { key: "daysLeft" as const, label: "Statutory Clock", render: clockCell },
  { key: "status" as const, label: "Status", cellType: "status" as const },
  { key: "firstAppeal" as const, label: "1st Appeal?" },
];

export function RTIClient({ rtis, today }: Props) {
  const [active, setActive] = useState("All");

  const isDue = (r: RTIApplication) =>
    (r.status === "received" || r.status === "under_review" || r.status === "forwarded");
  const isOverdue = (r: RTIApplication) => {
    const n = daysRemaining(r.deadlineDate, today);
    return n !== null && n < 0 && !CLOSED.has(r.status);
  };

  const filtered =
    active === "Due"
      ? rtis.filter(isDue)
      : active === "Overdue"
      ? rtis.filter(isOverdue)
      : rtis;

  const rows: Row[] = filtered.map((r) => ({
    id: r.id,
    rtiNo: r.rtiNo,
    applicantName: r.applicantName,
    subject: r.subject,
    publicAuthority: r.publicAuthority ?? "—",
    filedDate: formatIndianDate(r.filedDate),
    deadlineDate: formatIndianDate(r.deadlineDate),
    daysLeft: daysRemaining(r.deadlineDate, today),
    closed: CLOSED.has(r.status),
    status: r.status,
    firstAppeal: r.isFirstAppeal ? "Yes" : "No",
  }));

  return (
    <div className="card">
      <div className="card-h">
        <h3>Application List</h3>
        <div role="group" aria-label="Filter RTI applications">
          <Segmented value={active} onChange={setActive} options={SEG_OPTIONS} />
        </div>
      </div>
      {rtis.length === 0 ? (
        <EmptyState icon="📄" title="No RTI applications" message="Applications filed under RTI Act 2005 will appear here." />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          sortable
          filterable
          pageSize={15}
          rowLinkKey="id"
          rowLinkPrefix="/citizen/rti/"
        />
      )}
    </div>
  );
}
