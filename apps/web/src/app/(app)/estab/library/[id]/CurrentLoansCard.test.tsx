import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CurrentLoansCard } from "./CurrentLoansCard";

const BOOK_ID = "b1";
const EMP_ID = "00000000-0000-0000-0000-000000000001";

describe("CurrentLoansCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GAP-ESTAB-LIBRARY-DETAIL-02: shows borrower names for this book's current loans", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/estab/library/issues") && url.includes("status=issued")) {
        return new Response(
          JSON.stringify([{
            id: "i1", bookId: BOOK_ID, bookTitle: "Manual",
            borrowerRef: EMP_ID, issuedAt: "2026-09-01T00:00:00Z",
            dueAt: "2026-09-15T00:00:00Z", status: "issued",
          }]),
          { status: 200 },
        );
      }
      if (url.includes("/estab/library/issues") && url.includes("status=overdue")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/hrms/employees")) {
        return new Response(
          JSON.stringify({ data: [{ id: EMP_ID, employeeNo: "E-001", name: "Priya Sharma", department: "Admin" }] }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });

    render(<CurrentLoansCard bookId={BOOK_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Priya Sharma (E-001)")).toBeInTheDocument();
    });
  });

  it("shows empty state when no copies are out", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify([]), { status: 200 }),
    );

    render(<CurrentLoansCard bookId={BOOK_ID} />);

    await waitFor(() => {
      expect(screen.getByText("All copies on the shelf")).toBeInTheDocument();
    });
  });
});
