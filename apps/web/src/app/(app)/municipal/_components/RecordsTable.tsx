import { DataTable } from "@/app/_components/ds";
import type { MunicipalServiceConfig } from "../_data/catalog";
import type { MunicipalRecordRow } from "../_data/records";

type Props = {
  config: MunicipalServiceConfig;
  rows: MunicipalRecordRow[];
};

export function RecordsTable({ config, rows }: Props) {
  const tableRows = rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    title: r.title,
    status: r.status,
    updatedAt: r.updatedAt,
  }));

  return (
    <DataTable
      columns={[
        { key: "reference", label: "Reference" },
        { key: "title", label: "Subject" },
        { key: "status", label: "Status", cellType: "status" },
        { key: "updatedAt", label: "Updated" },
      ]}
      rows={tableRows}
      rowLinkKey="id"
      rowLinkPrefix={`/municipal/${config.serviceKey}/applications/`}
      sortable
      filterable
      filterPlaceholder={`Filter ${config.resourceLabel.toLowerCase()}…`}
      emptyIcon="📂"
      emptyTitle={`No ${config.resourceLabel.toLowerCase()} yet`}
      emptyMessage={`Live ${config.resourceLabel.toLowerCase()} from ${config.label} will appear here once citizens submit or officers create records.`}
    />
  );
}
