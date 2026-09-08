import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrgHierarchyManager } from "./OrgHierarchyManager";
import type { AdminOrgUnit } from "@/app/_data/loaders";

const dept: AdminOrgUnit = {
  id: "unit-dept-1", tenantId: "t1", name: "Revenue Department",
  type: "department", parentId: null, headUserId: null, code: "REV",
};
const division: AdminOrgUnit = {
  id: "unit-div-1", tenantId: "t1", name: "Assessment Division",
  type: "division", parentId: "unit-dept-1", headUserId: null, code: null,
};

describe("OrgHierarchyManager (COMP-004: real tenant-service org-hierarchy)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Regression test for the bug this page replaced: the old page assumed a
  // fixed 5-level "Ministry -> Unit" model that does not exist in the real
  // backing store. This asserts the tree renders from the real flat
  // department/division/section/unit/branch taxonomy, with no invented
  // "Ministry" level.
  it("renders the real flat org-unit taxonomy as a parent/child tree, with no invented top level", () => {
    render(<OrgHierarchyManager initialUnits={[dept, division]} source="api" />);

    const tree = screen.getByRole("tree", { name: /organisation hierarchy/i });
    expect(tree).toBeInTheDocument();
    expect(screen.getByText("Revenue Department")).toBeInTheDocument();
    expect(screen.getByText("Assessment Division")).toBeInTheDocument();
    expect(screen.queryByText(/ministry/i)).not.toBeInTheDocument();
  });

  // Renaming a unit must PATCH the real tenant-service org-hierarchy
  // endpoint for that specific unit id, then refetch -- never mutate local
  // state alone (which would silently drift from the real backend).
  it("renames a unit against the real PATCH endpoint and refetches, rather than only updating local state", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (url === "/api/proxy/v1/admin/org-hierarchy/unit-dept-1" && method === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === "/api/proxy/v1/admin/org-hierarchy" && method === "GET") {
        return new Response(JSON.stringify({ data: [{ ...dept, name: "Revenue & Taxation Department" }, division] }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url} ${method}`);
    });

    render(<OrgHierarchyManager initialUnits={[dept, division]} source="api" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Rename" })[0]);
    const input = screen.getByLabelText("Rename Revenue Department");
    fireEvent.change(input, { target: { value: "Revenue & Taxation Department" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("Revenue & Taxation Department")).toBeInTheDocument());

    const patchCall = fetchSpy.mock.calls.find(
      ([u, i]) => String(u) === "/api/proxy/v1/admin/org-hierarchy/unit-dept-1" && (i as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(body).toEqual({ name: "Revenue & Taxation Department" });
  });

  // Sabotage check for the honest-failure path: a real upstream failure on
  // rename must surface as a visible error and must NOT silently rename the
  // node in local state as if it had persisted.
  it("shows a real error and leaves the unit name unchanged when the rename PATCH fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "cycle detected" }), { status: 422 }),
    );

    render(<OrgHierarchyManager initialUnits={[dept]} source="api" />);

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Rename Revenue Department");
    fireEvent.change(input, { target: { value: "Something Else" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent("cycle detected");
    expect(screen.getByText("Revenue Department")).toBeInTheDocument();
    expect(screen.queryByText("Something Else")).not.toBeInTheDocument();
  });
});
