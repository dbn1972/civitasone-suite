"use client";
import { useMemo, useState, type ReactNode, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { StatusPill } from "./StatusPill";
import { formatMoney, formatRupees, formatIndianDate, formatPercent } from "@/lib/formatters";

/**
 * DataTable is a "use client" component rendered from ~80+ call sites across
 * the app, most of whose own component tests render it directly (no
 * `<NextIntlClientProvider>` wrapper) -- next-intl's OWN convention here
 * (vitest.setup.ts's next-intl/server mock comment) is that only pages
 * translated via a SERVER-side getTranslations() get a free pass; a
 * client-side useTranslations() call is expected to be wrapped per-test.
 * useTranslations() throws synchronously ("...NextIntlClientProvider was not
 * found") when that provider is missing, so calling it unguarded here for
 * the new pagination labels would break every one of those existing tests
 * across every OTHER module, not just this Hindi-locale fix's own tests.
 * This falls back to the plain-English literal (no `<NextIntlClientProvider>`
 * -> no i18n coverage needed anyway -- these are the same defaults the
 * pagination labels had before this fix) instead of throwing, so a caller
 * that hasn't wrapped its test keeps working exactly as it always did; a
 * real page (always wrapped by the root layout) or a test that DOES wrap
 * with a provider gets the real, translated string.
 */
function useSafeTranslations(namespace: string, fallback: Record<string, string>): (key: string) => string {
  try {
    return useTranslations(namespace);
  } catch {
    return (key: string) => fallback[key] ?? key;
  }
}

/**
 * GAP-HR-APAR-DETAIL-04: date-only `formatIndianDate` (dd/MM/yyyy) has no
 * time component, so a stage-history "At" column showing a real timestamp
 * (e.g. two transitions on the same day) needs its own formatter. Kept
 * local rather than added to `@/lib/formatters` deliberately: an unrelated,
 * already-open PR (GAP-HR-SF-07, "formatIndianDateTime + todayIST/
 * addDaysIST") adds a shared export of that exact name to that exact file;
 * adding a second one here now would guarantee a same-name-same-file merge
 * conflict between the two PRs. This is a narrow, private helper for the
 * one cellType below; once SF-07 lands, a follow-up can delete this and
 * switch to the shared helper.
 */
function formatDateTimeIST(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" });
  const timePart = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  return `${datePart} ${timePart}`;
}

interface Column<T> {
  key: keyof T & string;
  label: string;
  align?: "left" | "right" | "center";
  /**
   * Use from client components only — cannot be passed from Server Components.
   * A function can't cross the Server->Client (RSC) boundary: TypeScript has no
   * way to see which side of that boundary a value was constructed on (a
   * function is a perfectly valid JS value either way), so this can't be
   * enforced at the type level. When a Server Component does it anyway, Next.js
   * throws while serializing that Server Component's props ("Functions cannot
   * be passed directly to Client Components...") *before DataTable's own code
   * ever runs* — see GAP-HR-EXPENSES-01 / PR #1647 for a real instance. Nothing
   * at runtime, here or anywhere else in this file, can intercept or improve
   * *that* crash; `scripts/ci/datatable-render-guard.mjs` (wired into the
   * Architecture Guard CI job) is what actually prevents it, by flagging
   * `render:` in any file that isn't a Client Component before it ships. What
   * DataTable *can* do at runtime is refuse to blow up on a `render` that is
   * present but not callable, and warn naming the offending column — see
   * cellValue() below — which covers plain typos/bugs and any codepath where a
   * bad value reaches a mounted client tree without ever hitting that CI guard.
   */
  render?: (row: T) => ReactNode;
  /** Server-safe: renders StatusPill/formatMoney/formatRupees/formatIndianDate/a date+time stamp/a percent from the row value at `key` */
  cellType?: "status" | "amount" | "rupees" | "date" | "datetime" | "percent";
  /**
   * Opt-in, server-safe: when cellType is "status", looks up the raw status
   * value in this map to pass StatusPill a translated label instead of its
   * own humanizeStatus(status) default. Plain data (not a function), so an
   * async Server Component can build it and pass it straight through, the
   * same way render cannot cross that boundary. Every existing caller omits
   * this and keeps the exact current behavior (GAP-PAYROLL-PERIOD-05).
   */
  statusLabels?: Record<string, string>;
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
  /**
   * Opt-in: the row field whose value names the row-link's accessible name
   * (`aria-label="Open <value>"`), independent of column display order.
   * Defaults to `columns[0].key`, so every existing consumer keeps today's
   * exact behavior unless it opts in. Set this when column 0 is an internal
   * code/id rather than the field a person would use to tell rows apart
   * (e.g. a vendor's code vs. the vendor's actual name) — see UX-015.
   */
  identifyingColumnKey?: keyof T & string;
  /** Opt-in: enable client-side column sorting (clickable headers, aria-sort). */
  sortable?: boolean;
  /** Opt-in: enable a client-side text filter box over all columns. */
  filterable?: boolean;
  /** Placeholder for the filter input. */
  filterPlaceholder?: string;
  /**
   * Opt-in: restrict the client-side text filter to these column keys instead
   * of every column in `columns` (the default when omitted — every existing
   * consumer keeps today's exact behavior unless it opts in). Use this to
   * keep a sensitive/free-text column visible in the table without making it
   * searchable — see hr/disciplinary and hr/vigilance's charges_summary
   * column (GAP-HR-DISCIPLINARY-01 / GAP-HR-VIGILANCE-01).
   */
  filterKeys?: (keyof T & string)[];
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
  /** Opt-in: show a "Download CSV" button in the toolbar. */
  exportable?: boolean;
  /** Filename for CSV export (without extension). */
  exportFilename?: string;
  /**
   * GAP-HR-LOANS-02: called with the exported row count and the active text
   * filter right before the CSV download starts, so a caller can record the
   * export (e.g. an audit event). Fire-and-forget: a failing callback must
   * never block the user's own download.
   */
  onExport?: (info: { rowCount: number; filter: string }) => void;
  /** GAP-HR-LOANS-02: when set, the CSV button opens a confirm dialog first (e.g. a sensitive-data notice). */
  exportConfirm?: { title: string; description: string; confirmLabel?: string };
  /** Screen-reader-only <caption> describing the table's purpose/scope. */
  caption?: string;
  /**
   * Opt-in: stack each row into a label/value list below 768px instead of
   * horizontally scrolling a shrunk table (GAP-HR-DIRECTORY-05). Off by
   * default -- zero visual change for the ~80 existing DataTable call sites
   * that don't pass this; every `<td>` already carries the `data-label`
   * attribute the CSS rule (civitas-ds.css's `.tbl--stack`) keys off of, so
   * turning this on is a one-line, purely additive opt-in per consumer.
   */
  mobileStack?: boolean;
  /**
   * Opt-in: derive each row's React key from the row's own identity rather
   * than the row shape's default `id` field — e.g. when a row's real
   * identity lives at a different field, or is composite. Only needed when
   * the default (below) doesn't fit; most call sites don't need this.
   */
  rowKey?: (row: T) => React.Key;
}

/**
 * A row's identity for React's reconciliation — never its position in
 * `visible`. Keying by array index (the previous behavior here) makes React
 * treat "whatever is now at position i" as the same element as "whatever
 * was at position i before", so a sort/filter silently re-labels an
 * in-place DOM node (and anything the browser is tracking on it, like
 * keyboard focus) with a different row's data instead of moving/unmounting
 * it — a keyboard user tabbed to one row can end up acting on a different
 * one after the rows reorder underneath them. Almost every row shape in
 * this app already carries a stable `id` (string | number); fall back to
 * the index only when a row genuinely has none, which keeps every existing
 * call site working unchanged while fixing the identity bug for the
 * overwhelming majority that do have one.
 */
function resolveRowKey<T extends Record<string, unknown>>(
  row: T,
  index: number,
  rowKey?: (row: T) => React.Key,
): React.Key {
  if (rowKey) return rowKey(row);
  const id = row.id;
  if (typeof id === "string" || typeof id === "number") return id;
  return index;
}

// Dev-mode dedup for the bad-`render` warning below: keyed by column identity
// (key+label), not by row, so a table with many rows only ever logs once per
// offending COLUMN DEFINITION, not once per cell.
const warnedRenderColumns = new Set<string>();

/**
 * "percent" cellType input: Postgres `numeric` columns reach the browser as
 * decimal strings ("10.00") via Drizzle/postgres.js, so a finite numeric
 * string is accepted as well as a number. Anything else renders as "—".
 */
function toPercentNumber(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function cellValue<T extends Record<string, unknown>>(col: Column<T>, row: T): ReactNode {
  if ("render" in col && col.render != null) {
    if (typeof col.render === "function") return col.render(row);
    // `render` is present but not callable -- most likely a Server Component
    // handed DataTable a function that Next.js's RSC serializer stripped or
    // otherwise failed to deliver intact (see the Column<T> doc comment above
    // for why this specific crash class can't be caught earlier, in here).
    // Rather than call it and crash with a bare "col.render is not a
    // function" deep in this file, warn loudly (once per column) and fall
    // through to this column's cellType/default rendering instead.
    if (process.env.NODE_ENV !== "production") {
      const dedupeKey = `${col.key}::${col.label}`;
      if (!warnedRenderColumns.has(dedupeKey)) {
        warnedRenderColumns.add(dedupeKey);
        // eslint-disable-next-line no-console -- dev-mode-only diagnostic, same rationale as RouteError.tsx
        console.error(
          `DataTable: column "${col.key}" (label "${col.label}") has a "render" prop that isn't a ` +
          `function (got ${typeof col.render}). This usually means a Server Component tried to pass a ` +
          `render function to DataTable ("use client") -- functions can't cross that boundary. Use a ` +
          `built-in cellType ("status" | "amount" | "rupees" | "date" | "datetime" | "percent") instead, or move this ` +
          `column's custom rendering into a Client Component. Falling back to this column's cellType/default ` +
          `rendering for now.`,
        );
      }
    }
  }
  if (col.cellType === "status") {
    const raw = String(row[col.key] ?? "");
    return <StatusPill status={raw} label={col.statusLabels?.[raw]} />;
  }
  if (col.cellType === "amount") {
    // UX-006: pass the raw value through — formatMoney() itself renders "—"
    // for null/undefined/non-finite, distinct from a genuine ₹0.00. Coercing
    // missing data to 0 here (the old `?? 0`) made a fetch/mapping gap look
    // like a real zero-rupee amount across every cellType:"amount" column.
    return formatMoney(row[col.key] as bigint | number | string | null | undefined);
  }
  if (col.cellType === "rupees") {
    return formatRupees(row[col.key] as number | string | null | undefined);
  }
  if (col.cellType === "date") {
    return formatIndianDate(row[col.key] as string | null | undefined);
  }
  if (col.cellType === "datetime") {
    return formatDateTimeIST(row[col.key] as string | null | undefined);
  }
  if (col.cellType === "percent") {
    return formatPercent(toPercentNumber(row[col.key]));
  }
  return String(row[col.key] ?? "");
}

/**
 * UX-014: derive a `searchbox`-appropriate accessible name from the existing,
 * already page-specific `filterPlaceholder` text, instead of requiring a new
 * prop across every DataTable consumer (~80+ call sites). Most call sites
 * already write "Filter <entity>…" or "Search <entity>…"; both are
 * normalized to a consistent "Search <entity>" name. Text that matches
 * neither shape (a non-English translation, or other free-form copy) is
 * passed through unchanged — it's already descriptive and page-specific,
 * just not re-worded to start with "Search".
 */
function accessibleFilterLabel(placeholder: string): string {
  const trimmed = placeholder.trim().replace(/(?:…|\.{3,})$/u, "").trim();
  if (!trimmed || /^filter$/i.test(trimmed)) return "Search records";
  if (/^search\b/i.test(trimmed)) return trimmed;
  const m = /^filter\s+(?:by\s+)?(.+)$/i.exec(trimmed);
  return m ? `Search ${m[1].trim()}` : trimmed;
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
  identifyingColumnKey,
  sortable = false,
  filterable = false,
  filterPlaceholder = "Filter…",
  filterKeys,
  pageSize,
  emptyIcon = "📋",
  emptyTitle = "No records found",
  emptyMessage = "There are no items to display yet.",
  emptyAction,
  exportable = false,
  exportFilename = "export",
  onExport,
  exportConfirm,
  caption,
  mobileStack = false,
  rowKey,
}: DataTableProps<T>) {
  const router = useRouter();
  // Hindi-locale finding: this shared pager's own labels ("Page X of Y",
  // "← Prev"/"Next →") were hardcoded English, unlike every column label a
  // caller passes in -- ~80+ DataTable call sites across the app all
  // inherit this fix at once. Reuses the app's existing generic
  // "action"/"common" namespaces (next/previous already exist there — see
  // apps/web/src/messages/en.json — precisely because they're meant for
  // reuse like this) rather than adding a third, DataTable-specific
  // namespace; only "records" is new (added to "common" alongside its
  // existing page/of/rows/total pagination vocabulary).
  const tAction = useSafeTranslations("action", { previous: "Previous", next: "Next", clearFilter: "Clear filter" });
  const tCommon = useSafeTranslations("common", { page: "Page", of: "of", records: "records" });

  const [sortKey, setSortKey] = useState<(keyof T & string) | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState("");
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
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
    const searchKeys: (keyof T & string)[] = filterKeys ?? columns.map((col) => col.key);
    return rows.filter((row) =>
      searchKeys.some((key) => String(row[key] ?? "").toLowerCase().includes(q)),
    );
  }, [rows, columns, filter, filterable, filterKeys]);

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

  function csvCellValue<T2 extends Record<string, unknown>>(col: Column<T2>, row: T2): string {
    if (col.cellType === "amount") return String(formatMoney(row[col.key] as number | null) ?? "");
    if (col.cellType === "rupees") return String(formatRupees(row[col.key] as number | string | null) ?? "");
    if (col.cellType === "date") return formatIndianDate(row[col.key] as string | null | undefined);
    if (col.cellType === "datetime") return formatDateTimeIST(row[col.key] as string | null | undefined);
    if (col.cellType === "percent") return String(formatPercent(toPercentNumber(row[col.key])) ?? "");
    if (col.cellType === "status") return String(row[col.key] ?? "");
    return String(row[col.key] ?? "");
  }

  function downloadCsv() {
    try {
      onExport?.({ rowCount: sorted.length, filter });
    } catch {
      /* never block the download on an audit-callback failure */
    }
    const header = columns.map((c) => c.label).join(",");
    const csvRows = sorted.map((row) =>
      columns.map((col) => {
        const val = csvCellValue(col, row).replace(/"/g, '""');
        return val.includes(",") || val.includes('"') || val.includes("\n") ? `"${val}"` : val;
      }).join(",")
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportFilename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {(filterable || exportable) && (
        <div className="dt-toolbar" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {filterable && (
            <div className="dt-filter" style={{ flex: 1 }}>
              <span aria-hidden="true" style={{ fontSize: 13 }}>🔍</span>
              <input
                type="search"
                value={filter}
                placeholder={filterPlaceholder}
                aria-label={accessibleFilterLabel(filterPlaceholder)}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(0);
                }}
              />
            </div>
          )}
          {exportable && sorted.length > 0 && (
            <Button variant="ghost" size="sm" onClick={exportConfirm ? () => setExportConfirmOpen(true) : downloadCsv} style={{ whiteSpace: "nowrap" }}>
              ⬇ CSV
            </Button>
          )}
          {exportConfirm && (
            <ConfirmDialog
              open={exportConfirmOpen}
              title={exportConfirm.title}
              description={exportConfirm.description}
              confirmLabel={exportConfirm.confirmLabel}
              onConfirm={() => { setExportConfirmOpen(false); downloadCsv(); }}
              onCancel={() => setExportConfirmOpen(false)}
            />
          )}
        </div>
      )}

      {visible.length === 0 ? (
        // GAP-HR-OVERTIME-07: a filter that matches nothing showed the same
        // static empty state as a genuinely empty table, with no way back to
        // the full list except manually clearing the filter box — this is
        // the one case where DataTable knows something the caller's own
        // emptyAction doesn't (that `filter` itself is the reason), so it
        // takes over the action slot only in this specific, narrow state;
        // every other caller's existing emptyAction is unaffected.
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          message={emptyMessage}
          action={
            filterable && filter.trim() ? (
              <Button variant="ghost" size="sm" onClick={() => { setFilter(""); setPage(0); }}>
                {tAction("clearFilter")}
              </Button>
            ) : emptyAction
          }
        />
      ) : (
        <div className="tbl-wrap">
        <table className={mobileStack ? "tbl tbl--stack" : "tbl"}>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((col) => {
                const canSort = sortable && col.sortable !== false;
                return (
                  <th
                    key={col.key}
                    scope="col"
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
                  key={resolveRowKey(row, i, rowKey)}
                  className={href ? "clickable row-link" : undefined}
                  // A <tr> keeps its native, non-interactive "row" role even
                  // with a click handler bolted on -- assistive tech never
                  // learns it's actionable, and it's skipped by AT quick-nav
                  // (e.g. NVDA/JAWS "next button"). role="button" exposes the
                  // affordance; Enter/Space activation already existed below.
                  role={href ? "button" : undefined}
                  onClick={href ? () => router.push(href) : undefined}
                  onKeyDown={href ? (e) => onRowKeyDown(e, href) : undefined}
                  tabIndex={href ? 0 : undefined}
                >
                  {columns.map((col, colIndex) => {
                    const cellContent = cellValue(col, row);
                    return (
                      <td
                        key={col.key}
                        className={col.align === "right" ? "num" : undefined}
                        // Always present (harmless when unstyled): the CSS
                        // attribute selector that turns this into a visible
                        // label only fires under .tbl--stack (mobileStack),
                        // so every other DataTable consumer's markup grows
                        // this attribute but renders pixel-identical.
                        data-label={col.label}
                      >
                        {colIndex === 0 && href ? (
                          <a
                            href={href}
                            tabIndex={-1}
                            aria-label={`Open ${String(row[identifyingColumnKey ?? columns[0].key] ?? "row")}`}
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
        </div>
      )}

      {usePaging && sorted.length > 0 && (
        <div className="dt-pager">
          <Button
            variant="ghost"
            size="sm"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← {tAction("previous")}
          </Button>
          <span aria-live="polite">
            {tCommon("page")} {safePage + 1} {tCommon("of")} {pageCount}
            <span className="sr-only"> ({sorted.length} {tCommon("records")})</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            {tAction("next")} →
          </Button>
        </div>
      )}
    </div>
  );
}
