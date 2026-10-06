import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("./EscalationsTable", () => ({
  EscalationsTable: ({ rows }: { rows: unknown[] }) => <div>esc-table:{rows.length}</div>,
}));

import EscalationsPage from "./page";

function mock(rows: unknown[]) {
  fetchJsonMock.mockImplementation(() => Promise.resolve({ data: rows, source: "api" }));
}
function tile(label: string): string | null | undefined {
  return screen.getByText(label).parentElement?.textContent;
}

const mk = (severity: string, status: string) => ({
  escalationId: "E", project: "P", issue: "i", severity, escalatedTo: "x", raisedDate: "2026-01-01", status,
});

describe("EscalationsPage tile counts (GAP-PROJECTS-ESCALATIONS-01)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("counts a blocked+open escalation as Critical but NOT a blocked+cleared one", async () => {
    mock([mk("blocked", "open"), mk("blocked", "cleared")]);
    render(await EscalationsPage());
    expect(tile("Critical")).toContain("1");
  });

  it("excludes cleared rows from High and counts them under Resolved", async () => {
    mock([mk("overdue", "open"), mk("overdue", "cleared")]);
    render(await EscalationsPage());
    expect(tile("High")).toContain("1");
    expect(tile("Resolved")).toContain("1");
  });

  it("uses the honest 'Resolved' label (no unfilterable 'This Month' claim)", async () => {
    mock([]);
    render(await EscalationsPage());
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.queryByText("Resolved This Month")).not.toBeInTheDocument();
  });
});
