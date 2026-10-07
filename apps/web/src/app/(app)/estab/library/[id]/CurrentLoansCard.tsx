"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, DataTable, EmptyState, ErrorState } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { resolveEmployees } from "@/lib/entityAdapters/employee";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { LibraryIssueSummary } from "@civitasone/types";

type Row = {
  id: string;
  borrower: string;
  issuedAt: string;
  dueAt: string;
  _borrowerRef: string;
};

/**
 * GAP-ESTAB-LIBRARY-DETAIL-02: shows who currently holds this book's copies —
 * borrower (resolved from the HRMS directory, web-side), issue date and due
 * date. Only mounted for roles allowed to manage the catalogue (the page
 * gates it), since borrower identity is PII.
 */
export function CurrentLoansCard({ bookId }: { bookId: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = useState<Row[]>([]);

  async function load() {
    setState("loading");
    try {
      const issues = await browserJson<LibraryIssueSummary[]>(
        `v1/estab/library/issues?status=issued&bookId=${encodeURIComponent(bookId)}`,
      );
      // 'issued' excludes overdue in the API's status enum; also fetch overdue
      // so a book that is out AND overdue still appears.
      const overdue = await browserJson<LibraryIssueSummary[]>(
        `v1/estab/library/issues?status=overdue&bookId=${encodeURIComponent(bookId)}`,
      );
      const out = [...(issues ?? []), ...(overdue ?? [])];
      const ids = [...new Set(out.map((i) => i.borrowerRef))];
      let nameMap = new Map<string, string>();
      if (ids.length > 0) {
        const opts = await resolveEmployees(ids);
        nameMap = new Map(opts.map((o) => [o.id, o.label]));
      }
      setRows(out.map((i) => ({
        id: i.id,
        borrower: nameMap.get(i.borrowerRef) ?? "—",
        issuedAt: formatIndianDate(i.issuedAt.slice(0, 10)),
        dueAt: formatIndianDate(i.dueAt.slice(0, 10)),
        _borrowerRef: i.borrowerRef,
      })));
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  return (
    <Card title="Currently issued" padding>
      {state === "loading" ? (
        <p className="sub" style={{ margin: 0 }}>Loading current loans…</p>
      ) : state === "error" ? (
        <ErrorState error={toHumanError("load", { area: "current loans" })} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <EmptyState icon="📚" title="All copies on the shelf" message="No copies of this book are currently out." />
      ) : (
        <DataTable<Row>
          columns={[
            {
              key: "borrower",
              label: "Borrower",
              render: (row: Row) => <span title={row._borrowerRef}>{row.borrower}</span>,
            },
            { key: "issuedAt", label: "Issued" },
            { key: "dueAt", label: "Due" },
            {
              key: "id",
              label: "",
              sortable: false,
              render: () => (
                <Link href="/estab/library/issues" className="btn ghost" style={{ minHeight: 36 }}>
                  View loans
                </Link>
              ),
            },
          ]}
          rows={rows}
          pageSize={10}
        />
      )}
    </Card>
  );
}
