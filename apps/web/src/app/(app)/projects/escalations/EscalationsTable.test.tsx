import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EscalationsTable, type EscalationRow } from "./EscalationsTable";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({
    data: initial, fromCache: false, offline: false, cachedAt: null, provenance: "live",
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const row: EscalationRow = {
  escalationId: "ESC-001",
  projectId: "p-7",
  project: "Rural Roads",
  issue: "Timeline exceeded",
  severity: "blocked",
  escalatedTo: "Program Director",
  raisedDate: "2026-01-01",
  status: "open",
};

describe("EscalationsTable (GAP-PROJECTS-ESCALATIONS-02/03)", () => {
  it("renders an OPEN escalation with a non-green (bad) pill, not the global green", () => {
    render(<EscalationsTable rows={[row]} />);
    const pill = screen.getByText("Open");
    expect(pill).toHaveClass("pill", "bad");
    expect(pill).not.toHaveClass("good");
  });

  it("shows severity as 'Critical'/'High', not the raw blocked/overdue status words", () => {
    render(<EscalationsTable rows={[row, { ...row, severity: "overdue", projectId: "p-8", project: "Bridge" }]} />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.queryByText("blocked")).not.toBeInTheDocument();
  });

  it("links the row to its project via projectId", () => {
    render(<EscalationsTable rows={[row]} />);
    const link = screen.getByRole("link", { name: /Open Rural Roads/i });
    expect(link).toHaveAttribute("href", "/projects/p-7");
  });
});
