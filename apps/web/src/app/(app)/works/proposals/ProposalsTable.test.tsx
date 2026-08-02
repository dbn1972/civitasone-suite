import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, initialData: unknown[]) => ({
    data: initialData,
    fromCache: false,
    offline: false,
    cachedAt: null,
  }),
}));

import { ProposalsTable } from "./ProposalsTable";

const rows = [
  {
    id: "p1",
    workNumber: "WRK/2026/001",
    description: "Culvert construction",
    category: "Regular",
    type: "3f9a1c20…",
    estimatedCost: "5000000",
    status: "draft",
    office: "9c2d4e11…",
  },
  {
    id: "p2",
    workNumber: "WRK/2026/002",
    description: "Road widening",
    category: "Deposit",
    type: "aa11bb22…",
    estimatedCost: "12000000",
    status: "dao_finalized",
    office: "cc33dd44…",
  },
];

describe("ProposalsTable", () => {
  it("renders happy path rows and their work numbers", () => {
    render(<ProposalsTable proposals={rows} source="api" />);
    expect(screen.getByText("WRK/2026/001")).toBeInTheDocument();
    expect(screen.getByText("WRK/2026/002")).toBeInTheDocument();
  });

  it("shows a guided empty state when there are no proposals", () => {
    render(<ProposalsTable proposals={[]} source="api" />);
    expect(screen.getByText("No proposals found")).toBeInTheDocument();
    expect(screen.getByText("Work proposals will appear here once created.")).toBeInTheDocument();
  });

  it("falls back to the empty state when the loader reports an error and no rows", () => {
    render(<ProposalsTable proposals={[]} source="error" />);
    expect(screen.getByText("No proposals found")).toBeInTheDocument();
  });
});
