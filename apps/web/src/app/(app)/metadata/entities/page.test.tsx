import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import MetadataEntitiesPage from "./page";

const MOCK_ENTITIES = [
  { id: "e1", label: "Grievance", sublabel: "Citizen-facing grievance record", status: "active" },
];

function mockEntities(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/metadata/entities")) {
      return Promise.resolve(result);
    }
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("MetadataEntitiesPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders entity definitions on success", async () => {
    mockEntities({ data: MOCK_ENTITIES, source: "api" });
    render(await MetadataEntitiesPage());
    expect(screen.getByText(/Grievance/)).toBeInTheDocument();
  });

  it("shows the honest empty state when a tenant genuinely has zero entities (source: api, [])", async () => {
    mockEntities({ data: [], source: "api" });
    render(await MetadataEntitiesPage());
    expect(screen.getByText("No entities")).toBeInTheDocument();
  });

  it("shows the error state — not the empty-state prompt — on a real fetch failure (source: error)", async () => {
    mockEntities({ data: [], source: "error" });
    render(await MetadataEntitiesPage());
    expect(screen.getByText("We couldn't load this entity definitions.")).toBeInTheDocument();
    expect(screen.queryByText("No entities")).not.toBeInTheDocument();
  });
});
