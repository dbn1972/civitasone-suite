"use client";

import { useState } from "react";
import Link from "next/link";
import { DataTable, Segmented } from "@/app/_components/ds";

export type FileRow = {
  id: string;
  fileNo: string;
  subject: string;
  classification: string;
  department: string;
  createdBy: string;
  status: string;
  statusRaw: string;
};

// "Active" (not "With me"): the file rows carry no per-officer holder, so this
// filters by status, not by the signed-in officer. The real per-desk view is
// /estab/inbox ("My Desk").
const SEGMENTS = ["All", "Active", "In transit", "Closed"];

export function FilesTable({ rows }: { rows: FileRow[] }) {
  const [seg, setSeg] = useState("All");

  const filtered = rows.filter((r) => {
    switch (seg) {
      case "Active":
        return r.statusRaw === "active";
      case "In transit":
        return r.statusRaw === "pending";
      case "Closed":
        return r.statusRaw === "archived" || r.statusRaw === "disposed";
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
          { key: "classification", label: "Classification" },
          { key: "department", label: "Department" },
          { key: "createdBy", label: "Created By" },
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
