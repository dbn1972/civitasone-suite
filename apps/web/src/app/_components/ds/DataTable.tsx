"use client";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "./EmptyState";
import { StatusPill } from "./StatusPill";

interface Column<T> {
  key: keyof T & string;
  label: string;
  align?: "left" | "right" | "center";
  /** Use from client components only — cannot be passed from Server Components */
  render?: (row: T) => ReactNode;
  /** Server-safe: renders StatusPill from the row value at `key` */
  cellType?: "status" | "amount";
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  rows: T[];
  /** Client-only row link builder */
  rowHref?: (row: T) => string;
  /** Server-safe: link first column to `${rowLinkPrefix}${row[rowLinkKey]}` */
  rowLinkKey?: keyof T & string;
  rowLinkPrefix?: string;
}

function cellValue<T extends Record<string, unknown>>(col: Column<T>, row: T): ReactNode {
  if (col.render) return col.render(row);
  if (col.cellType === "status") return <StatusPill status={String(row[col.key] ?? "")} />;
  if (col.cellType === "amount") {
    const minor = Number(row[col.key] ?? 0);
    return `₹${(minor / 100).toLocaleString("en-IN")}`;
  }
  return String(row[col.key] ?? "");
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  rowHref,
  rowLinkKey,
  rowLinkPrefix,
}: DataTableProps<T>) {
  const router = useRouter();

  const resolveHref = (row: T): string | undefined => {
    if (rowHref) return rowHref(row);
    if (rowLinkKey && rowLinkPrefix) return `${rowLinkPrefix}${row[rowLinkKey]}`;
    return undefined;
  };

  if (rows.length === 0) {
    return (
      <EmptyState icon="📋" title="No records found" message="There are no items to display yet." />
    );
  }

  return (
    <table className="tbl">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} style={{ textAlign: col.align ?? "left" }}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const href = resolveHref(row);
          return (
            <tr
              key={i}
              className={href ? "clickable" : undefined}
              onClick={href ? () => router.push(href) : undefined}
            >
              {columns.map((col, colIndex) => {
                const cellContent = cellValue(col, row);
                return (
                  <td
                    key={col.key}
                    className={col.align === "right" ? "num" : undefined}
                  >
                    {colIndex === 0 && href ? (
                      <a
                        href={href}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(href); }}
                      >
                        {cellContent}
                      </a>
                    ) : cellContent}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
