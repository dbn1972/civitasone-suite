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

  // GAP-METADATA-ENTITIES-01: the filled state is now a real table (shared
  // MetadataRowsTable / DataTable), not a raw JSON.stringify <pre> dump.
  it("renders entity definitions in a table on success (no raw JSON dump)", async () => {
    mockEntities({ data: MOCK_ENTITIES, source: "api" });
    const { container } = render(await MetadataEntitiesPage());
    expect(screen.getByText(/Grievance/)).toBeInTheDocument();
    // A table, with the business label visible…
    expect(container.querySelector("table")).not.toBeNull();
    // …and no <pre> JSON dump and no object-literal braces leaking to the DOM.
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent ?? "").not.toContain('"label":');
  });

  // GAP-METADATA-ENTITIES-02: the empty state names the resource and does NOT
  // tell a business admin to use an API.
  it("shows an honest empty state (no API mention) when a tenant genuinely has zero entities", async () => {
    mockEntities({ data: [], source: "api" });
    render(await MetadataEntitiesPage());
    expect(screen.getByText("No entities defined")).toBeInTheDocument();
    expect(screen.queryByText(/metadata API/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/api\//)).not.toBeInTheDocument();
  });

  it("shows the error state — not the empty-state prompt — on a real fetch failure (source: error)", async () => {
    mockEntities({ data: [], source: "error" });
    render(await MetadataEntitiesPage());
    expect(screen.getByText("We couldn't load entity definitions.")).toBeInTheDocument();
    expect(screen.queryByText("No entities defined")).not.toBeInTheDocument();
  });
});
