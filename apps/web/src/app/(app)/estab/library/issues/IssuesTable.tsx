"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, DataTable, Segmented, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { resolveEmployees } from "@/lib/entityAdapters/employee";
import { formatIndianDate } from "@/lib/formatters";
import type { LibraryIssueSummary } from "@civitasone/types";

type IssueRow = LibraryIssueSummary & Record<string, unknown>;

const SEGMENTS = ["All", "On Loan", "Overdue", "Returned"];

export function IssuesTable({ rows }: { rows: LibraryIssueSummary[] }) {
  const router = useRouter();
  const [seg, setSeg] = useState("All");
  const [selected, setSelected] = useState<LibraryIssueSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();

  // GAP-ESTAB-LIBRARY-ISSUES-01: resolve borrower UUIDs to names web-side
  // using the HRMS employee adapter (no cross-service SQL).
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const ids = [...new Set(rows.map((r) => r.borrowerRef))];
    if (ids.length === 0) return;
    let cancelled = false;
    resolveEmployees(ids).then((opts) => {
      if (cancelled) return;
      setNameMap(new Map(opts.map((o) => [o.id, o.label])));
    }).catch(() => { /* keep UUIDs as fallback */ });
    return () => { cancelled = true; };
  }, [rows]);

  const filtered = rows.filter((r) => {
    // GAP-ESTAB-LIBRARY-ISSUES-02: "On Loan" = issued OR overdue (both are
    // physically out); "Overdue" stays a subset.
    if (seg === "On Loan") return r.status === "issued" || r.status === "overdue";
    if (seg === "Overdue") return r.status === "overdue";
    if (seg === "Returned") return r.status === "returned";
    return true;
  });

  const tableRows: IssueRow[] = filtered.map((i) => ({
    ...i,
    bookTitleDisplay: i.bookTitle ?? "—",
    borrowerDisplay: nameMap.get(i.borrowerRef) ?? "—",
    issuedAtDisplay: formatIndianDate(i.issuedAt.slice(0, 10)),
    dueAtDisplay: formatIndianDate(i.dueAt.slice(0, 10)),
    returnedAtDisplay: i.returnedAt ? formatIndianDate(i.returnedAt.slice(0, 10)) : "—",
  }));

  async function confirmReturn() {
    if (!selected) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson(`v1/estab/library/issues/${selected.id}/return`, { method: "PATCH" });
      setSelected(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card-h">
        <h3>Loans</h3>
        <Segmented options={SEGMENTS} value={seg} onChange={setSeg} />
      </div>
      <DataTable<IssueRow>
        columns={[
          { key: "bookTitleDisplay", label: "Book" },
          {
            key: "borrowerDisplay",
            label: "Borrower",
            render: (row: IssueRow) => (
              <span title={row.borrowerRef as string}>{row.borrowerDisplay as string}</span>
            ),
          },
          { key: "issuedAtDisplay", label: "Issued" },
          { key: "dueAtDisplay", label: "Due" },
          { key: "returnedAtDisplay", label: "Returned" },
          { key: "status", label: "Status", cellType: "status" },
          {
            key: "id",
            label: "Action",
            sortable: false,
            render: (row: IssueRow) =>
              row.status === "returned" ? (
                <span style={{ color: "var(--ink2)", fontSize: 12.5 }}>Returned {row.returnedAtDisplay as string}</span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  style={{ minHeight: 36 }}
                  aria-label={`Return ${row.bookTitleDisplay as string} — borrower ${(row.borrowerDisplay as string) || row.borrowerRef}`}
                  onClick={() => {
                    setDialogError(undefined);
                    setSelected(row);
                  }}
                >
                  Return
                </Button>
              ),
          },
        ]}
        rows={tableRows}
        sortable
        filterable
        filterPlaceholder="Filter by book, borrower…"
        pageSize={15}
        emptyIcon="📖"
        emptyTitle="No loans match this filter"
        emptyMessage="Try a different filter."
      />

      <ConfirmDialog
        open={selected !== null}
        title="Mark this book returned?"
        confirmLabel="Confirm return"
        busy={busy}
        errorMessage={dialogError}
        description={
          selected ? (
            <>
              Mark <strong>{selected.bookTitle ?? "this book"}</strong> as returned by{" "}
              <strong>{nameMap.get(selected.borrowerRef) ?? "the borrower"}</strong>.
            </>
          ) : (
            "Mark this loan returned?"
          )
        }
        onConfirm={() => void confirmReturn()}
        onCancel={() => !busy && setSelected(null)}
      />
    </>
  );
}
