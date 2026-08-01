"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, Segmented, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
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

  const filtered = rows.filter((r) => {
    if (seg === "On Loan") return r.status === "issued";
    if (seg === "Overdue") return r.status === "overdue";
    if (seg === "Returned") return r.status === "returned";
    return true;
  });

  const tableRows: IssueRow[] = filtered.map((i) => ({
    ...i,
    bookTitleDisplay: i.bookTitle ?? "—",
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
          { key: "borrowerRef", label: "Borrower" },
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
                <button
                  type="button"
                  className="btn ghost"
                  style={{ minHeight: 36 }}
                  aria-label={`Return ${row.bookTitleDisplay as string} — borrower ${row.borrowerRef}`}
                  onClick={() => {
                    setDialogError(undefined);
                    setSelected(row);
                  }}
                >
                  Return
                </button>
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
              Mark <strong>{selected.bookTitle ?? "this book"}</strong> as returned by borrower{" "}
              <strong>{selected.borrowerRef}</strong>.
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
