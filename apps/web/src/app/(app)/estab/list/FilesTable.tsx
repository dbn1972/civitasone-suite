"use client";

import { useState } from "react";
import Link from "next/link";
import { DataTable, Segmented, StatusPill } from "@/app/_components/ds";
import { formatIndianDate, todayIST } from "@/lib/formatters";
import { isClosedStatus } from "@/lib/estab/sla";

export type FileRow = {
  id: string;
  fileNo: string;
  subject: string;
  classification: string;
  classificationRaw?: string;
  department: string;
  createdBy: string;
  status: string;
  statusRaw: string;
  dueDate?: string;
};

// GAP-ESTAB-LIST-06: renamed "In transit" → "Pending" to match the stat label.
const SEGMENTS = ["All", "Active", "Pending", "Closed"];

// GAP-ESTAB-LIST-01/05: classification → StatusPill tone.
const CLASSIFICATION_TONE: Record<string, "good" | "info" | "bad" | "mut" | "warn"> = {
  unclassified: "info",
  restricted: "info",
  confidential: "mut",
  secret: "bad",
  top_secret: "bad",
};

export function FilesTable({ rows }: { rows: FileRow[] }) {
  const [seg, setSeg] = useState("All");

  const today = todayIST();

  const filtered = rows.filter((r) => {
    switch (seg) {
      case "Active":
        return r.statusRaw === "active";
      // GAP-ESTAB-LIST-06: segment filter "Pending" matches the stat "Pending".
      case "Pending":
        return r.statusRaw === "pending";
      case "Closed":
        return isClosedStatus(r.statusRaw);
      default:
        return true;
    }
  });

  return (
    <>
      <div className="card-h">
        <h3>File register &amp; tracking</h3>
        <Segmented options={SEGMENTS} value={seg} onChange={setSeg} />
      </div>
      <DataTable<FileRow>
        columns={[
          { key: "fileNo", label: "File No" },
          { key: "subject", label: "Subject" },
          {
            key: "classification",
            label: "Classification",
            // GAP-ESTAB-LIST-01/05: render as a StatusPill with tone.
            render: (row: FileRow) => (
              <StatusPill
                status={row.classificationRaw ?? row.classification}
                label={row.classification}
                variant={CLASSIFICATION_TONE[row.classificationRaw ?? ""] ?? "info"}
              />
            ),
          },
          { key: "department", label: "Department" },
          { key: "createdBy", label: "Created By" },
          {
            // GAP-ESTAB-LIST-03: surface dueDate with overdue highlight.
            key: "dueDate",
            label: "Due",
            render: (row: FileRow) => {
              if (!row.dueDate) return <span style={{ color: "var(--ink2)" }}>—</span>;
              const overdue = row.dueDate < today && !isClosedStatus(row.statusRaw);
              return (
                <span style={overdue ? { color: "var(--bad)", fontWeight: 600 } : undefined}>
                  {formatIndianDate(row.dueDate)}
                </span>
              );
            },
          },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={filtered}
        rowLinkKey="id"
        rowLinkPrefix="/estab/files/"
        sortable
        filterable
        filterPlaceholder="Filter files…"
        pageSize={10}
        emptyIcon="🗂️"
        emptyTitle="No files yet"
        emptyMessage="Open a file to start moving notes and approvals between desks."
        emptyAction={
          <Link href="/estab/files/new" className="btn primary" style={{ marginTop: 10 }}>
            Open a new file
          </Link>
        }
      />
    </>
  );
}
