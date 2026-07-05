"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { CitizenNotice } from "../../../_data/loaders";

type NoticeRow = {
  id: string;
  noticeNo: string;
  subject: string;
  department: string;
  published: string;
  expiry: string;
  type: string;
} & Record<string, unknown>;

export function NoticesTable({ notices, source = "api" }: { notices: CitizenNotice[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<CitizenNotice[]>(
    "citizen.notices",
    notices,
    source,
    (d) => d.length === 0,
  );

  const tableRows = useMemo<NoticeRow[]>(
    () =>
      rows.map((n) => ({
        id: n.id,
        noticeNo: n.noticeNo,
        subject: n.subject,
        department: n.department,
        published: n.published,
        expiry: n.expiry,
        type: n.type,
      })),
    [rows],
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="Notice Board">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
        <EmptyState icon="📰" title="No notices published" message="Statutory and informational notices will appear here once published." />
      ) : (
        <DataTable<NoticeRow>
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Search notice no, subject, department…"
          pageSize={15}
          exportable
          exportFilename="citizen-notices"
          columns={[
            { key: "noticeNo", label: "Notice No." },
            { key: "subject", label: "Subject" },
            { key: "department", label: "Department" },
            { key: "published", label: "Published" },
            { key: "expiry", label: "Expiry" },
            { key: "type", label: "Type", cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}
