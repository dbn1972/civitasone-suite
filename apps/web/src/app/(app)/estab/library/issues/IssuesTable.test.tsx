import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { IssuesTable } from "./IssuesTable";
import type { LibraryIssueSummary } from "@civitasone/types";

const EMP_ID = "00000000-0000-0000-0000-000000000001";

const issues: LibraryIssueSummary[] = [
  {
    id: "i1",
    bookId: "b1",
    bookTitle: "Fundamental Rules",
    borrowerRef: EMP_ID,
    issuedAt: "2026-09-01T00:00:00Z",
    dueAt: "2026-09-15T00:00:00Z",
    status: "issued",
  },
  {
    id: "i2",
    bookId: "b2",
    bookTitle: "Service Rules",
    borrowerRef: EMP_ID,
    issuedAt: "2026-09-01T00:00:00Z",
    dueAt: "2026-08-15T00:00:00Z",
    status: "overdue",
  },
];

describe("IssuesTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GAP-ESTAB-LIBRARY-ISSUES-01: resolves borrower UUID to employee name", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/hrms/employees")) {
        return new Response(
          JSON.stringify({ data: [{ id: EMP_ID, employeeNo: "E-001", name: "Priya Sharma", department: "Admin" }] }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });

    render(<IssuesTable rows={issues} />);

    // Initially shows — while resolving, then resolves to name
    await waitFor(() => {
      expect(screen.getAllByText("Priya Sharma (E-001)")).toHaveLength(2);
    });
    // UUID should not appear as visible text
    expect(screen.queryByText(EMP_ID)).not.toBeInTheDocument();
  });

  it("shows fallback dash when employee resolution fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<IssuesTable rows={issues} />);

    // Should show — as fallback
    await waitFor(() => {
      const cells = screen.getAllByText("—");
      expect(cells.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("CLOS2-S1-03: issued/due/returned dates roll over to the IST calendar day", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const rolled: LibraryIssueSummary[] = [
      {
        id: "i9", bookId: "b9", bookTitle: "Rollover Book", borrowerRef: EMP_ID,
        issuedAt: "2026-10-22T20:30:00.000Z", dueAt: "2026-11-04T19:00:00.000Z",
        returnedAt: "2026-11-05T20:00:00.000Z", status: "returned",
      } as LibraryIssueSummary,
    ];
    render(<IssuesTable rows={rolled} />);
    expect((await screen.findAllByText("23 Oct 2026"))[0]).toBeInTheDocument();
    expect(screen.getAllByText("05 Nov 2026")[0]).toBeInTheDocument();
    expect(screen.getAllByText("06 Nov 2026")[0]).toBeInTheDocument();
  });
});
