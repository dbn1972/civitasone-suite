"use client";

import { useState } from "react";
import { DataTable, Segmented } from "@/app/_components/ds";
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
          { key: "status", label: "Status", cellType: "status" },
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
