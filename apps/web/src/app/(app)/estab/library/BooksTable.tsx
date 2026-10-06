"use client";

import { useState } from "react";
import { DataTable, Segmented, StatusPill } from "@/app/_components/ds";
import type { LibraryBookSummary } from "@civitasone/types";

type BookRow = LibraryBookSummary & Record<string, unknown>;

const SEGMENTS = ["All", "Available", "Out of stock"];

export function BooksTable({ rows }: { rows: LibraryBookSummary[] }) {
  const [seg, setSeg] = useState("All");

  const filtered = rows.filter((r) => {
    if (seg === "Available") return r.status === "available";
    if (seg === "Out of stock") return r.status === "unavailable";
    return true;
  });

  const tableRows: BookRow[] = filtered.map((b) => ({
    ...b,
    author: b.author ?? "—",
    copiesDisplay: `${b.copiesAvailable} / ${b.copiesTotal}`,
  }));

  return (
    <>
      <div className="card-h">
        <h3>Catalogue</h3>
        <Segmented options={SEGMENTS} value={seg} onChange={setSeg} />
      </div>
      <DataTable<BookRow>
        columns={[
          { key: "title", label: "Title" },
          { key: "author", label: "Author" },
          { key: "accessionNo", label: "Accession No." },
          { key: "copiesDisplay", label: "Available / Total", sortable: false },
          {
            key: "status",
            label: "Status",
            // GAP-ESTAB-LIBRARY-04: use the same term ("Out of stock") as the
            // segment and the "Titles Out of Stock" stat, and give the
            // out-of-stock state a bad tone instead of the neutral fallback.
            render: (row: BookRow) =>
              row.status === "unavailable" ? (
                <StatusPill status="unavailable" label="Out of stock" variant="bad" />
              ) : (
                <StatusPill status="available" label="Available" variant="good" />
              ),
          },
        ]}
        rows={tableRows}
        rowLinkKey="id"
        rowLinkPrefix="/estab/library/"
        sortable
        filterable
        filterPlaceholder="Filter by title, author, accession no…"
        pageSize={15}
        emptyIcon="📚"
        emptyTitle="No books match this filter"
        emptyMessage="Try a different filter."
      />
    </>
  );
}
