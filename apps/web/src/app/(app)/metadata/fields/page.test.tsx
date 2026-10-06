import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import MetadataFieldsPage from "./page";

const ENTITIES = [
  { id: "11111111-1111-4000-8000-000000000001", label: "Grievance", status: "active" },
];
const FIELDS = [
  { id: "f1", label: "Subject", sublabel: "text", status: "active" },
  { id: "f2", label: "Priority", sublabel: "picklist", status: "active" },
];

function routeImpl(opts: { fields?: unknown } = {}) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    const p = typeof path === "string" ? path : "";
    if (p.includes("/metadata/entities/") && p.endsWith("/fields")) {
      return Promise.resolve({ data: opts.fields ?? FIELDS, source: "api" });
    }
    if (p.includes("/metadata/entities")) {
      return Promise.resolve({ data: ENTITIES, source: "api" });
    }
    // GAP-METADATA-FIELDS-02: there is NO top-level /metadata/fields endpoint.
    return Promise.resolve({ data: [], source: "error" });
  });
}

describe("MetadataFieldsPage (GAP-METADATA-FIELDS-01/-02/-03/-04)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  // FIELDS-03/-04: with no entity selected, show the picker + an honest prompt,
  // and never expose an /api/ path.
  it("prompts the user to choose an entity when none is selected", async () => {
    routeImpl();
    const { container } = render(await MetadataFieldsPage({ searchParams: {} }));
    expect(screen.getByText(/Choose an entity to see its fields/i)).toBeInTheDocument();
    expect(screen.getByText("Select an entity…")).toBeInTheDocument();
    expect(container.textContent ?? "").not.toContain("/api/");
  });

  // FIELDS-02: selecting an entity loads that entity's fields via the
  // entity-scoped route (…/entities/:id/fields), NOT the dead top-level path.
  it("loads fields from the entity-scoped route and renders them in a table", async () => {
    routeImpl();
    const entityId = ENTITIES[0].id;
    const { container } = render(await MetadataFieldsPage({ searchParams: { entity: entityId } }));
    expect(screen.getByText("Subject")).toBeInTheDocument();
    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();

    const calledPaths = fetchJsonMock.mock.calls.map((c) => c[0] as string);
    expect(calledPaths.some((p) => p === `/api/v1/metadata/entities/${entityId}/fields`)).toBe(true);
    expect(calledPaths.some((p) => p === "/api/v1/metadata/fields")).toBe(false);
  });

  // FIELDS-01: a selected entity with no fields shows an honest empty state.
  it("shows an honest empty state when the selected entity has no fields", async () => {
    routeImpl({ fields: [] });
    const { container } = render(await MetadataFieldsPage({ searchParams: { entity: ENTITIES[0].id } }));
    expect(screen.getByText("No fields defined")).toBeInTheDocument();
    expect(container.querySelector("pre")).toBeNull();
  });
});
