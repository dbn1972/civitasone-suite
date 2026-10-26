"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, DataTable, Segmented, ConfirmDialog, Select, Textarea } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { resolveEmployees } from "@/lib/entityAdapters/employee";
import { formatIndianDate } from "@/lib/formatters";
import type { LibraryIssueSummary } from "@civitasone/types";

type IssueRow = LibraryIssueSummary & Record<string, unknown>;

const SEGMENTS = ["All", "On Loan", "Overdue", "Returned"];

type ReturnCondition = "good" | "fair" | "damaged";
const CONDITIONS: ReturnCondition[] = ["good", "fair", "damaged"];

/** Calendar day (YYYY-MM-DD, UTC) of an ISO instant - loans are stored at 00:00Z, so this round-trips. */
function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
function addDaysUtc(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function IssuesTable({ rows }: { rows: LibraryIssueSummary[] }) {
  const router = useRouter();
  const t = useTranslations("estabLibraryLoans");
  const [seg, setSeg] = useState("All");
  const [selected, setSelected] = useState<LibraryIssueSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  // Owner decision #29: condition on return, and renewal.
  const [condition, setCondition] = useState<ReturnCondition>("good");
  const [notes, setNotes] = useState("");
  const [renewing, setRenewing] = useState<LibraryIssueSummary | null>(null);
  const [renewDay, setRenewDay] = useState("");
  const [renewError, setRenewError] = useState<string | undefined>();

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
    issuedAtDisplay: formatIndianDate(i.issuedAt),
    dueAtDisplay: formatIndianDate(i.dueAt),
    returnedAtDisplay: i.returnedAt ? formatIndianDate(i.returnedAt) : "—",
  }));

  async function confirmReturn() {
    if (!selected) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson(`v1/estab/library/issues/${selected.id}/return`, {
        method: "PATCH",
        body: JSON.stringify({ condition, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
      });
      setSelected(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function openRenew(row: LibraryIssueSummary) {
    setRenewError(undefined);
    setRenewDay(addDaysUtc(utcDay(row.dueAt), 14));
    setRenewing(row);
  }

  async function confirmRenew() {
    if (!renewing) return;
    const current = utcDay(renewing.dueAt);
    if (!renewDay || renewDay <= current) {
      setRenewError(t("renewNotAfter", { date: formatIndianDate(renewing.dueAt) }));
      return;
    }
    setBusy(true);
    setRenewError(undefined);
    try {
      await browserJson(`v1/estab/library/issues/${renewing.id}/renew`, {
        method: "PATCH",
        body: JSON.stringify({ dueAt: new Date(`${renewDay}T00:00:00.000Z`).toISOString() }),
      });
      setRenewing(null);
      router.refresh();
    } catch (err) {
      setRenewError(err instanceof Error ? err.message : t("networkError"));
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
                <span style={{ color: "var(--ink2)", fontSize: 12.5 }}>
                  Returned {row.returnedAtDisplay as string}
                  {row.returnCondition ? (
                    <span style={{ display: "block" }} title={(row.returnNotes as string | undefined) ?? undefined}>
                      {t("conditionShown", { condition: t(`condition_${row.returnCondition as ReturnCondition}`) })}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <Button
                    type="button"
                    variant="ghost"
                    style={{ minHeight: 36 }}
                    aria-label={`Return ${row.bookTitleDisplay as string} — borrower ${(row.borrowerDisplay as string) || row.borrowerRef}`}
                    onClick={() => {
                      setDialogError(undefined);
                      setCondition("good");
                      setNotes("");
                      setSelected(row);
                    }}
                  >
                    Return
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    style={{ minHeight: 36 }}
                    aria-label={`Renew ${row.bookTitleDisplay as string} — borrower ${(row.borrowerDisplay as string) || row.borrowerRef}`}
                    onClick={() => openRenew(row)}
                  >
                    {t("renew")}
                  </Button>
                  {(row.renewalCount as number | undefined) ? (
                    <span style={{ color: "var(--ink2)", fontSize: 12.5 }}>
                      {t("renewedCount", { count: row.renewalCount as number })}
                    </span>
                  ) : null}
                </span>
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
      >
        <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>
            {t("conditionLabel")}
            <Select value={condition} onChange={(e) => setCondition(e.target.value as ReturnCondition)}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>{t(`condition_${c}`)}</option>
              ))}
            </Select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>
            {t("notesLabel")}
            <Textarea value={notes} maxLength={500} rows={2} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={renewing !== null}
        title={t("renewTitle")}
        confirmLabel={t("renewConfirm")}
        busy={busy}
        errorMessage={renewError}
        description={
          renewing ? (
            <>
              {t("renewBody", { title: renewing.bookTitle ?? t("thisBook"), date: formatIndianDate(renewing.dueAt) })}
            </>
          ) : null
        }
        onConfirm={() => void confirmRenew()}
        onCancel={() => !busy && setRenewing(null)}
      >
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600, marginTop: 8 }}>
          {t("renewDateLabel")}
          <input
            type="date"
            value={renewDay}
            onChange={(e) => setRenewDay(e.target.value)}
            style={{ minHeight: 40, padding: "0 10px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", background: "var(--panel)", color: "var(--ink)" }}
          />
        </label>
      </ConfirmDialog>
    </>
  );
}
