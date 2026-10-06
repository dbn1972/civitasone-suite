import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { ProgramsTable } from "./ProgramsTable";
import type { LoyaltyProgramRow } from "../_data";

const mockedHook = vi.mocked(useSeededResource);

function seed(rows: LoyaltyProgramRow[], provenance = "live") {
  mockedHook.mockReturnValue({
    data: rows as never,
    fromCache: false,
    offline: false,
    cachedAt: null,
    provenance,
  } as never);
}

const sample: LoyaltyProgramRow[] = [
  {
    id: "ab12cd34-0000-4000-8000-000000000001",
    name: "City Rewards",
    status: "active",
    earnRatio: "100",
    expiryDays: 365,
    updatedAt: "2026-08-14T09:12:44.000Z",
  },
];

beforeEach(() => seed(sample));

describe("ProgramsTable (GAP-LOYALTY-PROGRAMS-01/02)", () => {
  it("PROGRAMS-01: first column is the programme name, not an 8-char id fragment", () => {
    render(<ProgramsTable rows={sample} source="api" />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveTextContent("Programme");
    expect(screen.getByText("City Rewards")).toBeInTheDocument();
    expect(screen.queryByText("ab12cd34")).not.toBeInTheDocument();
  });

  it("PROGRAMS-02: status renders as a toned pill (humanised), not raw lowercase", () => {
    render(<ProgramsTable rows={sample} source="api" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
  });

  it("error-no-data renders retry state", () => {
    seed([], "error-no-data");
    render(<ProgramsTable rows={[]} source="error" />);
    expect(screen.getByText(/couldn't load loyalty programmes/i)).toBeInTheDocument();
  });
});
