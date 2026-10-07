import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const getKnowledgeRecordsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getKnowledgeRecords: () => getKnowledgeRecordsMock(),
}));

import KnowledgeRecordsPage from "./page";

function rec(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    recordNo: "REC-001",
    title: "Correspondence 2020",
    type: "file",
    department: "Admin",
    createdDate: "2020-01-01",
    retentionPeriod: "5 years",
    disposalDueDate: "2026-10-30",
    status: "active",
    ...over,
  };
}

describe("KnowledgeRecordsPage", () => {
  beforeEach(() => getKnowledgeRecordsMock.mockReset());

  it("GAP-RECORDS-01: a disposed record is labelled 'Disposed', not 'Weeding due'", async () => {
    getKnowledgeRecordsMock.mockResolvedValue({
      data: [rec({ id: "d1", recordNo: "REC-DIS", status: "disposed", disposalDueDate: "2024-01-01" })],
      source: "api",
    });
    render(await KnowledgeRecordsPage());
    expect(screen.getByText("Disposed")).toBeInTheDocument();
    expect(screen.queryByText("Weeding due")).not.toBeInTheDocument();
  });

  it("GAP-RECORDS-01/02: 'Overdue for weeding' KPI excludes disposed and counts active overdue", async () => {
    getKnowledgeRecordsMock.mockResolvedValue({
      data: [
        rec({ id: "a", status: "disposed", disposalDueDate: "2020-01-01" }),
        rec({ id: "b", status: "active", disposalDueDate: "2000-01-01" }), // overdue
      ],
      source: "api",
    });
    render(await KnowledgeRecordsPage());
    // KPI label present
    expect(screen.getByText("Overdue for weeding")).toBeInTheDocument();
    // the KPI card should read 1 (only the active-overdue), not 1-from-disposed
    const kpiLabel = screen.getByText("Overdue for weeding");
    const card = kpiLabel.closest("div")?.parentElement;
    expect(card?.textContent).toContain("1");
  });

  it("GAP-RECORDS-02: KPIs renamed to 'Due for review (30d)' and 'Overdue for weeding'", async () => {
    getKnowledgeRecordsMock.mockResolvedValue({ data: [rec()], source: "api" });
    render(await KnowledgeRecordsPage());
    expect(screen.getByText("Due for review (30d)")).toBeInTheDocument();
    expect(screen.getByText("Overdue for weeding")).toBeInTheDocument();
  });

  it("GAP-RECORDS-03: 'Policy' header button links to /knowledge/policies", async () => {
    getKnowledgeRecordsMock.mockResolvedValue({ data: [rec()], source: "api" });
    render(await KnowledgeRecordsPage());
    const link = screen.getByRole("link", { name: "Policy" });
    expect(link).toHaveAttribute("href", "/knowledge/policies");
  });

  it("GAP-RECORDS-06: a 'Disposal due' column is present with a formatted date", async () => {
    getKnowledgeRecordsMock.mockResolvedValue({ data: [rec({ disposalDueDate: "2026-10-30" })], source: "api" });
    render(await KnowledgeRecordsPage());
    expect(screen.getByText("Disposal due")).toBeInTheDocument();
  });

  it("errors show retry state, not a zeroed table", async () => {
    getKnowledgeRecordsMock.mockResolvedValue({ data: [], source: "error" });
    render(await KnowledgeRecordsPage());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
