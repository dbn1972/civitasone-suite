"use client";
import Link from "next/link";
import { DataTable, StatusPill } from "../../../_components/ds";

type ExRow = { id: string; label: string; severity: string; count: number; href: string };

/**
 * GAP-CRM-CONTROL-TOWER-06: the drill-down target comes from the exception
 * feed. Only render a client-side <Link> for an in-app absolute path
 * ("/crm/..."); anything else (a "javascript:" URL, a protocol-relative
 * "//evil", an external or empty href) is NOT turned into a link, so a
 * compromised or misbehaving feed can never inject a navigable target. The
 * link carries an aria-label naming the exception so screen-reader users know
 * which row "Open" acts on.
 */
function isSafeInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function ExceptionTable({ rows }: { rows: ExRow[] }) {
  return (
    <DataTable<ExRow>
      columns={[
        { key: "label", label: "Exception" },
        {
          key: "severity",
          label: "Severity",
          render: (row) => <StatusPill status={row.severity} label={row.severity} />,
        },
        { key: "count", label: "Count", align: "right" },
        {
          key: "href",
          label: "Drill down",
          render: (row) =>
            isSafeInternalHref(row.href) ? (
              <Link className="btn" href={row.href} aria-label={`Open ${row.label}`}>
                Open
              </Link>
            ) : (
              <span className="btn" aria-disabled="true" style={{ opacity: 0.5, pointerEvents: "none" }}>
                Open
              </span>
            ),
        },
      ]}
      rows={rows}
      emptyIcon="🚨"
      emptyTitle="No exceptions"
      emptyMessage="Follow-ups, ageing leads and dormant accounts will surface here."
    />
  );
}
