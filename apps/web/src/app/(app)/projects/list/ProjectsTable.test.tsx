import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DataProvenance } from "@/lib/sync/resource";

const seededState = { provenance: "live" as DataProvenance };
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({
    data: initial,
    fromCache: seededState.provenance === "cached",
    offline: false,
    cachedAt: null,
    provenance: seededState.provenance,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ProjectsTable, type ProjectRow } from "./ProjectsTable";

const row: ProjectRow = {
  id: "p1", projectCode: "PRJ-1", name: "Rural Roads", scheme: "PMGSY",
  department: "PWD", totalBudget: 10_000_000, completionPct: 12.5, status: "delayed", rag: "red",
};

describe("ProjectsTable (GAP-PROJECTS-LIST-01/03/05)", () => {
  it("GAP-PROJECTS-LIST-05: renders a per-row RAG pill with colour + word", () => {
    seededState.provenance = "live";
    render(<ProjectsTable rows={[row]} source="api" />);
    const pill = screen.getByText("Red");
    expect(pill).toHaveClass("pill", "bad");
    expect(screen.getByText("RAG")).toBeInTheDocument();
  });

  it("GAP-PROJECTS-LIST-03: formats completion % to one decimal in the cell", () => {
    seededState.provenance = "live";
    render(<ProjectsTable rows={[row]} source="api" />);
    expect(screen.getByText("12.5%")).toBeInTheDocument();
  });

  it("GAP-PROJECTS-LIST-01: error-no-data shows the error state with retry, not 'No projects yet'", () => {
    seededState.provenance = "error-no-data";
    render(<ProjectsTable rows={[]} source="error" />);
    expect(screen.getByText(/We couldn't load projects\./i)).toBeInTheDocument();
    expect(screen.queryByText("No projects yet")).not.toBeInTheDocument();
  });

  it("GAP-PROJECTS-LIST-01: cached data still shows the table (not the error state)", () => {
    seededState.provenance = "cached";
    render(<ProjectsTable rows={[row]} source="error" />);
    expect(screen.getByText("Rural Roads")).toBeInTheDocument();
    expect(screen.queryByText(/We couldn't load projects\./i)).not.toBeInTheDocument();
  });
});
