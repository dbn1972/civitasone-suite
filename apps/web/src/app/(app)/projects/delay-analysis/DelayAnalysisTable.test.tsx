import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DelayAnalysisTable, type DelayRow } from "./DelayAnalysisTable";

// Keep the offline cache out of the test: render the seeded initialData directly.
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({
    data: initial,
    fromCache: false,
    offline: false,
    cachedAt: null,
    provenance: "live",
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mk = (rag: string, projectId?: string): DelayRow => ({
  project: "Rural Roads",
  originalDeadline: "2026-01-01",
  revisedDeadline: "2026-03-01",
  delayDays: 59,
  cause: "land acquisition",
  rag,
  ...(projectId ? { projectId } : {}),
});

describe("DelayAnalysisTable RAG column (GAP-PROJECTS-DELAY-ANALYSIS-01/02)", () => {
  it("renders an amber 'Amber' pill for a 'review' row (delay-analysis vocabulary)", () => {
    render(<DelayAnalysisTable rows={[mk("review")]} />);
    const pill = screen.getByText("Amber");
    expect(pill).toHaveClass("pill", "warn");
    // The old raw lifecycle label must not appear.
    expect(screen.queryByText("Review")).not.toBeInTheDocument();
    expect(screen.getByText("RAG")).toBeInTheDocument();
    expect(screen.queryByText("RAG Status")).not.toBeInTheDocument();
  });

  it("links the row to /projects/<projectId> when the backend supplies one", () => {
    render(<DelayAnalysisTable rows={[mk("red", "p-123")]} />);
    const link = screen.getByRole("link", { name: /Open Rural Roads/i });
    expect(link).toHaveAttribute("href", "/projects/p-123");
  });

  it("leaves the row un-linked (no .../undefined) when projectId is absent", () => {
    render(<DelayAnalysisTable rows={[mk("red")]} />);
    expect(screen.queryByRole("link", { name: /Open Rural Roads/i })).not.toBeInTheDocument();
  });
});
