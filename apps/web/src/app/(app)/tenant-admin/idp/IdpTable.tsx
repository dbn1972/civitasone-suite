"use client";

import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { endpointOrigin, formatDateTimeIST } from "@/lib/formatters";
import type { IdpProviderSummary } from "@/app/_data/loaders";

// GAP-TENANT-ADMIN-IDP-05: admin-service STATUSES = active | inactive | error.
// "error" is not in the shared StatusPill map (it fell back to neutral info), so a
// failing provider looked benign; pin it to "bad". Unknown values stay neutral.
const IDP_STATUS_VARIANT: Record<string, "good" | "mut" | "bad"> = { active: "good", inactive: "mut", error: "bad" };

export function IdpTable({ providers, source }: { providers: IdpProviderSummary[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("admin.idp.providers", providers, source, (d) => d.length === 0);

  // GAP-TENANT-ADMIN-IDP-04 / w0-report F5: FAIL-CLOSED audited export. The CSV is
  // only built after admin-service accepts the audit record (POST
  // /v1/admin/idp/providers/export-audit). A failed or unreachable audit call shows
  // a plain-language message and nothing leaves the screen, so an export can never
  // go unaudited. Never carries a status code or server text. Endpoint identifiers
  // are sensitive, so that column is excluded from the CSV (see csvExclude below).
  const t = useTranslations("idpExport");
  async function exportGuard(info: { rowCount: number; filter: string }): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/proxy/v1/admin/idp/providers/export-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ rowCount: info.rowCount, filter: info.filter || null }),
      });
      return res.ok ? { ok: true } : { ok: false, message: t("notRecorded") };
    } catch {
      return { ok: false, message: t("notRecorded") };
    }
  }

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<IdpProviderSummary & Record<string, unknown>>
      columns={[
        { key: "name", label: "Provider" },
        { key: "protocol", label: "Protocol" },
        { key: "status", label: "Status", render: (row) => <StatusPill status={row.status as string} variant={IDP_STATUS_VARIANT[row.status as string]} /> },
        { key: "usersSynced", label: "Users Synced" },
        {
          key: "endpoint",
          label: "Endpoint",
          // GAP-TENANT-ADMIN-IDP-03: scheme+host only (no realm/bind/query);
          // GAP-TENANT-ADMIN-IDP-04: and never written to the CSV.
          render: (row) => <span className="mono" style={{ fontSize: 11 }}>{endpointOrigin(row.endpoint as string)}</span>,
          csvExclude: true,
        },
        {
          key: "lastSync",
          label: "Last Sync",
          // GAP-TENANT-ADMIN-IDP-03: IST-labelled, "—" for null/invalid.
          render: (row) => formatDateTimeIST(row.lastSync as string),
        },
      ]}
      rows={data as (IdpProviderSummary & Record<string, unknown>)[]}
      sortable
      filterable
      filterPlaceholder="Search providers..."
      pageSize={15}
      exportable
      exportFilename="idp-providers"
      exportGuard={exportGuard}
      exportNotice="Export excludes endpoint URLs and is recorded in the audit log."
      />
    </>
  );
}
