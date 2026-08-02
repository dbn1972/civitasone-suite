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

import { BillingTable } from "./BillingTable";

const rows = [
  {
    id: "b1",
    billNo: "BILL/2026/001",
    work: "3f9a1c20…",
    mode: "E mb",
    gross: "1000000",
    netPayable: "950000",
    stage: "So finalized",
    status: "pending",
  },
  {
    id: "b2",
    billNo: "BILL/2026/002",
    work: "9c2d4e11…",
    mode: "Abstract",
    gross: "500000",
    netPayable: "500000",
    stage: "Do finalized",
    status: "finalized",
  },
];

describe("BillingTable", () => {
  it("renders happy path rows and their bill numbers", () => {
    render(<BillingTable bills={rows} source="api" />);
    expect(screen.getByText("BILL/2026/001")).toBeInTheDocument();
    expect(screen.getByText("BILL/2026/002")).toBeInTheDocument();
  });

  it("shows a guided empty state when there are no bills", () => {
    render(<BillingTable bills={[]} source="api" />);
    expect(screen.getByText("No bills found")).toBeInTheDocument();
    expect(screen.getByText("Works billing records will appear here.")).toBeInTheDocument();
  });

  it("falls back to the empty state when the loader reports an error and no rows", () => {
    render(<BillingTable bills={[]} source="error" />);
    expect(screen.getByText("No bills found")).toBeInTheDocument();
  });
});
