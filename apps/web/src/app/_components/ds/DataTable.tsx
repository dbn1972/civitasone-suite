"use client";
import { useMemo, useState, type ReactNode, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "./EmptyState";
import { StatusPill } from "./StatusPill";
import { formatMoney } from "@/lib/formatters";

interface Column<T> {
  key: keyof T & string;
  label: string;
  align?: "left" | "right" | "center";
  /** Use from client components only — cannot be passed from Server Components */
  render?: (row: T) => ReactNode;
  /** Server-safe: renders StatusPill from the row value at `key` */
  cellType?: "status" | "amount";
  /** Opt-in: set false to exclude a column from sorting when the table is sortable. */
  sortable?: boolean;
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  rows: T[];
  /** Client-only row link builder */
  rowHref?: (row: T) => string;
  /** Server-safe: link first column to `${rowLinkPrefix}${row[rowLinkKey]}` */
  rowLinkKey?: keyof T & string;
  rowLinkPrefix?: string;
  /** Opt-in: enable client-side column sorting (clickable headers, aria-sort). */
  sortable?: boolean;
  /** Opt-in: enable a client-side text filter box over all columns. */
  filterable?: boolean;
  /** Placeholder for the filter input. */
  filterPlaceholder?: string;
  /** Opt-in: enable pagination at the given page size. */
  pageSize?: number;
  /** Guided empty state: icon shown when there are no rows. */
  emptyIcon?: string;
  /** Guided empty state: friendly title, e.g. "No bills yet". */
  emptyTitle?: string;
  /** Guided empty state: one plain sentence on what to do next. */
  emptyMessage?: string;
  /** Guided empty state: a call-to-action (e.g. an "Add your first bill" link/button). */
  emptyAction?: ReactNode;
}

function cellValue<T extends Record<string, unknown>>(col: Column<T>, row: T): ReactNode {
  if (col.render) return col.render(row);
  if (col.cellType === "status") return <StatusPill status={String(row[col.key] ?? "")} />;
  if (col.cellType === "amount") {
    return formatMoney((row[col.key] ?? 0) as bigint | number | string);
  }
  return String(row[col.key] ?? "");
}

/** Stable, type-aware comparison used by the sort feature. */
function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "bigint" && typeof b === "bigint") return a < b ? -1 : a > b ? 1 : 0;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  rowHref,
  rowLinkKey,
  rowLinkPrefix,
  sortable = false,
  filterable = false,
  filterPlaceholder = "Filter…",
  pageSize,
  emptyIcon = "📋",
  emptyTitle = "No records found",
  emptyMessage = "There are no items to display yet.",
  emptyAction,
}: DataTableProps<T>) {
  const router = useRouter();

  const [sortKey, setSortKey] = useState<(keyof T & string) | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);

  const resolveHref = (row: T): string | undefined => {
    if (rowHref) return rowHref(row);
    if (rowLinkKey && rowLinkPrefix) return `${rowLinkPrefix}${row[rowLinkKey]}`;
    return undefined;
  };

  // 1) filter
  const filtered = useMemo(() => {
    if (!filterable || !filter.trim()) return rows;
    const q = filter.trim().toLowerCase();
    return rows.filter((row) =>
      columns.some((col) => String(row[col.key] ?? "").toLowerCase().includes(q)),
    );
  }, [rows, columns, filter, filterable]);

  // 2) sort
  const sorted = useMemo(() => {
    if (!sortable || !sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((ra, rb) => {
      const r = compareValues(ra[sortKey], rb[sortKey]);
      return sortDir === "asc" ? r : -r;
    });
    return copy;
  }, [filtered, sortable, sortKey, sortDir]);

  // 3) paginate
  const usePaging = typeof pageSize === "number" && pageSize > 0;
  const effPageSize = usePaging ? (pageSize as number) : 0;
  const pageCount = usePaging ? Math.max(1, Math.ceil(sorted.length / effPageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = usePaging
    ? sorted.slice(safePage * effPageSize, safePage * effPageSize + effPageSize)
    : sorted;

  const toggleSort = (key: keyof T & string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  };

  const ariaSortFor = (key: keyof T & string): "ascending" | "descending" | "none" => {
    if (sortKey !== key) return "none";
    return sortDir === "asc" ? "ascending" : "descending";
  };

  const onRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, href: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      router.push(href);
    }
  };

  return (
    <div>
      {filterable && (
        <div className="dt-toolbar">
          <div className="dt-filter">
            <span aria-hidden="true" style={{ fontSize: 13 }}>🔍</span>
            <input
              type="text"
              value={filter}
              placeholder={filterPlaceholder}
              aria-label={filterPlaceholder}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} action={emptyAction} />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              {columns.map((col) => {
                const canSort = sortable && col.sortable !== false;
                return (
                  <th
                    key={col.key}
                    style={{ textAlign: col.align ?? "left" }}
                    aria-sort={canSort ? ariaSortFor(col.key) : undefined}
                    className={canSort ? "sortable" : undefined}
                    onClick={canSort ? () => toggleSort(col.key) : undefined}
                    onKeyDown={
                      canSort
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleSort(col.key);
                            }
                          }
                        : undefined
                    }
                    tabIndex={canSort ? 0 : undefined}
                  >
                    {col.label}
                    {canSort && (
                      <span className="sort-ind" aria-hidden="true">
                        {sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => {
              const href = resolveHref(row);
              return (
                <tr
                  key={i}
                  className={href ? "clickable row-link" : undefined}
                  onClick={href ? () => router.push(href) : undefined}
                  onKeyDown={href ? (e) => onRowKeyDown(e, href) : undefined}
                  tabIndex={href ? 0 : undefined}
                  role={href ? "link" : undefined}
                  aria-label={href ? `Open ${String(row[columns[0].key] ?? "row")}` : undefined}
                >
                  {columns.map((col, colIndex) => {
                    const cellContent = cellValue(col, row);
                    return (
                      <td key={col.key} className={col.align === "right" ? "num" : undefined}>
                        {colIndex === 0 && href ? (
                          <a
                            href={href}
                            tabIndex={-1}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              router.push(href);
                            }}
                          >
                            {cellContent}
                          </a>
                        ) : (
                          cellContent
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {usePaging && sorted.length > 0 && (
        <div className="dt-pager">
          <button
            type="button"
            className="btn ghost sm"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Prev
          </button>
          <span aria-live="polite">
            Page {safePage + 1} of {pageCount}
            <span className="sr-only"> ({sorted.length} records)</span>
          </span>
          <button
            type="button"
            className="btn ghost sm"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
