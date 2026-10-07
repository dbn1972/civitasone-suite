import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { BooksTable } from "./BooksTable";
import type { LibraryBookSummary } from "@civitasone/types";

const rows: LibraryBookSummary[] = [
  {
    id: "b1",
    accessionNo: "ACC-001",
    title: "Available Title",
    author: "A",
    isbn: null,
    category: null,
    copiesTotal: 3,
    copiesAvailable: 2,
    status: "available",
  },
  {
    id: "b2",
    accessionNo: "ACC-002",
    title: "Out Title",
    author: "B",
    isbn: null,
    category: null,
    copiesTotal: 1,
    copiesAvailable: 0,
    status: "unavailable",
  },
] as unknown as LibraryBookSummary[];

describe("BooksTable", () => {
  it("GAP-ESTAB-LIBRARY-04: renders 'Out of stock' (not 'Unavailable') for unavailable rows", () => {
    render(<BooksTable rows={rows} />);
    // The segment uses the same term, so there may be more than one match.
    expect(screen.getAllByText("Out of stock").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
    // The raw humanized "Unavailable" must not be used as the pill label.
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });
});
