import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { AccrualsTable } from "./AccrualsTable";
import type { LoyaltyAccrualRow } from "../_data";

const mockedHook = vi.mocked(useSeededResource);

function seed(rows: LoyaltyAccrualRow[], provenance = "live") {
  mockedHook.mockReturnValue({ data: rows as never, fromCache: false, offline: false, cachedAt: null, provenance } as never);
}

const sample: LoyaltyAccrualRow[] = [
  {
    id: "a1111111-1111-4111-8111-111111111111",
    enrolmentId: "e2222222-2222-4222-8222-222222222222",
    points: "120000",
    source: "purchase",
    txType: "bonus",
    accrualDate: "2026-09-10T05:00:00.000Z",
    expiresAt: null,
  },
];

beforeEach(() => seed(sample));

describe("AccrualsTable (GAP-LOYALTY-ACCRUALS-01)", () => {
  it("shows ledger columns with en-IN points and a shortened enrolment ref", () => {
    render(<AccrualsTable rows={sample} source="api" />);
    for (const name of ["Date", "Type", "Source", "Enrolment ref", "Points", "Expires"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("1,20,000")).toBeInTheDocument();
    expect(screen.getByText("e2222222")).toBeInTheDocument();
    expect(screen.queryByText(/e2222222-2222-4222/)).not.toBeInTheDocument();
    expect(screen.getByText("No expiry")).toBeInTheDocument();
  });

  it("empty ledger shows an empty state, error shows a retry state (distinct)", () => {
    seed([]);
    const { unmount } = render(<AccrualsTable rows={[]} source="api" />);
    expect(screen.getByText("No accruals")).toBeInTheDocument();
    unmount();
    seed([], "error-no-data");
    render(<AccrualsTable rows={[]} source="error" />);
    expect(screen.getByText(/couldn't load accruals/i)).toBeInTheDocument();
    expect(screen.queryByText("No accruals")).not.toBeInTheDocument();
  });
});
