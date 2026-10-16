import { DataTable } from "@/app/_components/ds";
import type { MunicipalServiceConfig } from "../_data/services";
import type { MunicipalRecordRow } from "../_data/records";

type Props = {
  config: MunicipalServiceConfig;
  rows: MunicipalRecordRow[];
};

/** Short internal id fallback shown when a record has no human reference. */
function shortId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= 10) return `#${trimmed}`;
  return `#${trimmed.slice(0, 8)}`;
}

export function RecordsTable({ config, rows }: Props) {
  const tableRows = rows.map((r) => ({
    id: r.id,
    // GAP-...-APPLICATIONS-02: when the configured reference field is absent the
    // parser yields "—"; show a short id instead of three dashes so the row is
    // still identifiable.
    reference: r.reference === "—" ? shortId(r.id) : r.reference,
    title: r.title,
    status: r.status,
    updatedAt: r.updatedAt,
  }));

  return (
    <DataTable
      columns={[
        { key: "reference", label: "Reference" },
        { key: "title", label: "Subject" },
        {
          key: "status",
          label: "Status",
          cellType: "status",
          // GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-05: 'issued' is the positive terminal
          // state (licence issued) in every municipal service, but the shared StatusPill map
          // intentionally maps it to "info" for billing/treasury contexts. Override it here
          // for the municipal officer list only; add the two in-progress scrutiny states
          // that fall through to neutral "info" without an entry in the global map.
          statusVariants: { issued: "good", under_scrutiny: "warn", inspecting: "warn" } as const,
        },
        // GAP-...-APPLICATIONS-02: render the raw ISO timestamp as a formatted
        // IST date-time instead of printing it verbatim.
        { key: "updatedAt", label: "Updated", cellType: "datetime" },
      ]}
      rows={tableRows}
      rowLinkKey="id"
      rowLinkPrefix={`/municipal/${config.serviceKey}/applications/`}
      sortable
      filterable
      filterPlaceholder={`Filter ${config.resourceLabel.toLowerCase()}…`}
      emptyIcon="📂"
      emptyTitle={`No ${config.resourceLabel.toLowerCase()} yet`}
      // GAP-...-APPLICATIONS-04: dropped the "Live" wording from the empty copy.
      emptyMessage={`${config.resourceLabel} from ${config.label} will appear here once citizens submit or officers create records.`}
    />
  );
}
