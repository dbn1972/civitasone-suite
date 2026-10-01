"use client";

import { DataTable } from "@/app/_components/ds";

export interface AuditLogRow extends Record<string, unknown> {
  id: string;
  action: string;
  resource: string;
  /** Detail-page link for the audited entity, when its type has one. */
  href: string | null;
  actor: string;
  outcome: string;
  at: string | null;
}

interface Props {
  rows: AuditLogRow[];
  labels: {
    when: string;
    action: string;
    resource: string;
    actor: string;
    outcome: string;
    filterPlaceholder: string;
    emptyTitle: string;
    emptyMessage: string;
    caption: string;
  };
}

/**
 * Client wrapper so a per-row link can be passed to DataTable: `rowHref` is a
 * function, which a Server Component (the audit-log page) cannot hand to a
 * Client Component (GAP-HR-AUDIT-LOG-05).
 */
export function AuditLogTable({ rows, labels }: Props) {
  return (
    <DataTable<AuditLogRow>
      columns={[
        { key: "at", label: labels.when, cellType: "datetime" },
        { key: "action", label: labels.action },
        { key: "resource", label: labels.resource },
        { key: "actor", label: labels.actor },
        { key: "outcome", label: labels.outcome, cellType: "status" },
      ]}
      rows={rows}
      rowHref={(r) => r.href ?? ""}
      sortable
      filterable
      filterPlaceholder={labels.filterPlaceholder}
      exportable
      exportFilename="hr-audit-log"
      emptyIcon="📋"
      emptyTitle={labels.emptyTitle}
      emptyMessage={labels.emptyMessage}
      caption={labels.caption}
    />
  );
}
