"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { humanizeStatus } from "@/lib/formatters";
import { formatIndianDateTime } from "@/lib/formatters";
import type { SiemAlert } from "@/app/_data/loaders";
import { severityTone, severityRank, isCriticalSeverity, statusTone } from "./siemHelpers";

/**
 * GAP-TENANT-ADMIN-SIEM-04: record a CSV export as a fire-and-forget audit
 * beacon (same pattern as IdpTable). The alert title/source carry the incident
 * title + category (not personal data per the admin-service security-incident
 * store), so no field masking is required here; the egress itself is still
 * worth recording. A failed beacon must never block the user's own download.
 */
function recordExport(info: { rowCount: number; filter: string }): void {
  void fetch("/api/proxy/v1/admin/siem/alerts/export-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rowCount: info.rowCount, filtered: info.filter.trim().length > 0 }),
  }).catch(() => {
    /* audit is best-effort; a failed beacon must not block the export */
  });
}

export function SiemTable({ alerts, source }: { alerts: SiemAlert[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("admin.siem.alerts", alerts, source, (d) => d.length === 0);

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<SiemAlert & Record<string, unknown>>
        caption="Security alerts for this tenant"
        columns={[
          { key: "timestamp", label: "Time", render: (row) => formatIndianDateTime(row.timestamp as string) },
          { key: "title", label: "Alert" },
          {
            key: "_severityRank",
            label: "Severity",
            // Sort by severity rank (critical>high>medium>low), not alphabetically.
            csv: (row) => String(row.severity),
            render: (row) => {
              const sev = row.severity as string;
              const critical = isCriticalSeverity(sev);
              return (
                <span
                  className={`pill ${severityTone(sev)}`}
                  style={critical ? { fontWeight: 800, boxShadow: "inset 0 0 0 1px var(--bad, #d92d20)" } : undefined}
                >
                  {critical ? "🔴 " : ""}{humanizeStatus(sev)}
                </span>
              );
            },
          },
          { key: "source", label: "Source", render: (row) => humanizeStatus(String(row.source)) },
          { key: "status", label: "Status", render: (row) => <span className={`pill ${statusTone(row.status as string)}`}>{humanizeStatus(row.status as string)}</span> },
        ]}
        // Sort severity by rank: project a numeric rank the compareValues can order.
        rows={(data as (SiemAlert & Record<string, unknown>)[]).map((r) => ({ ...r, severity: r.severity, _severityRank: severityRank(String(r.severity)) }))}
        sortable
        filterable
        filterPlaceholder="Search alerts..."
        pageSize={15}
        exportable
        exportFilename="siem-alerts"
        onExport={recordExport}
        exportNotice="Exports are recorded in the audit log."
      />
    </>
  );
}
