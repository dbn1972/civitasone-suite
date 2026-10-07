import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const resourceMock = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => resourceMock(...a) }));

import { OpinionsTable } from "./OpinionsTable";

type Row = Record<string, unknown>;
const row = (over: Row = {}): Row => ({
  id: "op-1",
  opinionNo: "OPN/2026/0001",
  subject: "Tender dispute",
  requestedBy: "Jane Officer",
  advisorName: "Sr. Counsel",
  status: "pending",
  ...over,
});

function mockRows(rows: Row[]) {
  resourceMock.mockReturnValue({ data: rows, provenance: "live", offline: false, cachedAt: null, fromCache: false });
}

describe("OpinionsTable", () => {
  beforeEach(() => resourceMock.mockReset());

  // GAP-LEGAL-OPINIONS-02: each row links to /legal/opinions/{id}.
  it("links each row to its opinion detail page", () => {
    mockRows([row({ id: "abc-123" })]);
    render(<OpinionsTable items={[]} source="api" />);
    const link = screen.getByRole("link", { name: /OPN\/2026\/0001/ });
    expect(link).toHaveAttribute("href", "/legal/opinions/abc-123");
  });

  // GAP-LEGAL-OPINIONS-05: a null advisorName shows "Unassigned", not "Law Dept".
  it("renders Unassigned (not Law Dept) when there is no advisor", () => {
    mockRows([row({ advisorName: null })]);
    render(<OpinionsTable items={[]} source="api" />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.queryByText("Law Dept")).not.toBeInTheDocument();
  });

  it("shows the real advisor name when present", () => {
    mockRows([row({ advisorName: "Adv. Mehta" })]);
    render(<OpinionsTable items={[]} source="api" />);
    expect(screen.getByText("Adv. Mehta")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });
});
