import { DataTable } from "@/app/_components/ds";
import type { ModuleRowSummary } from "@civitasone/types";

/**
 * GAP-METADATA-{ENTITIES,FIELDS,RULES,RECORDS,FORMS}-01: the five metadata list
 * pages each rendered their filled state as a raw `JSON.stringify(data.slice(0,50))`
 * dump inside a <pre> — object keys (id/label/sublabel/status) shown as code to a
 * business admin, no table, no sort, and rows past 50 silently dropped.
 *
 * This is the one shared presentational table they now all use. It is a Server
 * Component (no "use client"): it passes DataTable only serialisable data —
 * `columns` with `cellType` (never a `render` function) and plain `rows` — so it
 * can be rendered straight from each page's async Server Component without
 * crossing the RSC function-prop boundary. DataTable's own client-side
 * sort/filter/pagination then make every fetched row reachable (no slice(0,50)
 * cap), which is why the pages drop the slice when they hand rows here.
 *
 * `resourceLabel` is the plural domain noun ("entities", "fields", …) used for the
 * row-count line and the (sr-only) table caption, so each page reads in business
 * terms rather than exposing an API path.
 */
interface MetadataRowsTableProps {
  rows: ModuleRowSummary[];
  /** Plural domain noun, lower-case, e.g. "entities". */
  resourceLabel: string;
  /** Singular domain noun, lower-case, e.g. "entity". */
  resourceSingular: string;
  /** Column header for the sublabel column, e.g. "Description" or "Type". */
  detailHeader?: string;
  /** Server-safe row link: first column links to `${rowLinkPrefix}${row.id}`. */
  rowLinkPrefix?: string;
}

export function MetadataRowsTable({
  rows,
  resourceLabel,
  resourceSingular,
  detailHeader = "Description",
  rowLinkPrefix,
}: MetadataRowsTableProps) {
  // Build fresh object literals so the row type is a plain
  // `Record<string, unknown>`-compatible shape (a bare `ModuleRowSummary`
  // interface has no index signature and so does not satisfy DataTable's
  // `T extends Record<string, unknown>` constraint — the same reason
  // municipal/_components/RecordsTable maps its rows this way).
  const tableRows = rows.map((row) => ({
    id: row.id,
    label: row.label,
    sublabel: row.sublabel ?? "—",
    status: row.status ?? "",
  }));
  const columns = [
    { key: "label" as const, label: "Name", sortable: true },
    { key: "sublabel" as const, label: detailHeader, sortable: true },
    { key: "status" as const, label: "Status", cellType: "status" as const, sortable: true },
    { key: "id" as const, label: "Id" },
  ];
  const total = tableRows.length;
  return (
    <div>
      <p className="text-sm text-muted" style={{ margin: "0 0 8px" }} aria-live="polite">
        {total} {total === 1 ? resourceSingular : resourceLabel}
      </p>
      <DataTable
        columns={columns}
        rows={tableRows}
        sortable
        filterable
        filterPlaceholder={`Filter ${resourceLabel}…`}
        pageSize={25}
        caption={`Custom ${resourceLabel} defined for your organisation`}
        {...(rowLinkPrefix !== undefined ? { rowLinkKey: "id" as const, rowLinkPrefix } : {})}
      />
    </div>
  );
}
