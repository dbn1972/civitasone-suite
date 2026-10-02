import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { OrgHierarchyManager, selfAndDescendantIds } from "./OrgHierarchyManager";
import type { AdminOrgUnit } from "@/app/_data/loaders";

const dept: AdminOrgUnit = {
  id: "unit-dept-1", tenantId: "t1", name: "Revenue Department",
  type: "department", parentId: null, headUserId: null, code: "REV",
};
const division: AdminOrgUnit = {
  id: "unit-div-1", tenantId: "t1", name: "Assessment Division",
  type: "division", parentId: "unit-dept-1", headUserId: null, code: null,
};
const section: AdminOrgUnit = {
  id: "unit-sec-1", tenantId: "t1", name: "Audit Section",
  type: "section", parentId: "unit-div-1", headUserId: null, code: null,
};
const other: AdminOrgUnit = {
  id: "unit-dept-2", tenantId: "t1", name: "Works Department",
  type: "department", parentId: null, headUserId: null, code: null,
};

const ORG = "/api/proxy/v1/admin/org-hierarchy";
const patches = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "PATCH");

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

    expect(screen.getByRole("list", { name: /organisation hierarchy/i })).toBeInTheDocument();
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
      if (url === `${ORG}/unit-dept-1` && method === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === ORG && method === "GET") {
        return new Response(JSON.stringify({ data: [{ ...dept, name: "Revenue & Taxation Department" }, division] }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url} ${method}`);
    });

    render(<OrgHierarchyManager initialUnits={[dept, division]} source="api" />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Revenue Department" }));
    const input = screen.getByRole("textbox", { name: "Rename Revenue Department" });
    fireEvent.change(input, { target: { value: "Revenue & Taxation Department" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("Revenue & Taxation Department")).toBeInTheDocument());

    const patchCall = fetchSpy.mock.calls.find(
      ([u, i]) => String(u) === `${ORG}/unit-dept-1` && (i as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(body).toEqual({ name: "Revenue & Taxation Department" });
  });

  // Sabotage check for the honest-failure path: a real upstream failure on
  // rename must surface as a visible error and must NOT silently rename the
  // node in local state as if it had persisted.
  //
  // UX-016: this used to assert the raw backend `message` ("cycle
  // detected") was echoed verbatim in the alert -- the same class of leak
  // useFormError/toHumanError closes fleet-wide (UX-003). The clerk-safe
  // replacement never shows backend-authored text, so this now asserts a
  // catalogued message instead, and explicitly that the raw text is absent.
  it("shows a clerk-safe error and leaves the unit name unchanged when the rename PATCH fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "cycle detected" }), { status: 422 }),
    );

    render(<OrgHierarchyManager initialUnits={[dept]} source="api" />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Revenue Department" }));
    const input = screen.getByRole("textbox", { name: "Rename Revenue Department" });
    fireEvent.change(input, { target: { value: "Something Else" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/cycle detected/);
    expect(screen.getByText("Revenue Department")).toBeInTheDocument();
    expect(screen.queryByText("Something Else")).not.toBeInTheDocument();
  });
});

// GAP-ADMIN-ORG-02
describe("OrgHierarchyManager rename commit semantics", () => {
  beforeEach(() => vi.restoreAllMocks());
  const okFetch = () =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "PATCH"
        ? new Response("{}", { status: 200 })
        : new Response(JSON.stringify({ data: [dept] }), { status: 200 }),
    );

  it("Enter followed by the trailing blur sends exactly one PATCH", async () => {
    const spy = okFetch();
    render(<OrgHierarchyManager initialUnits={[dept]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Revenue Department" }));
    const input = screen.getByRole("textbox", { name: "Rename Revenue Department" });
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(patches(spy)).toHaveLength(1));
  });

  it("Escape followed by the trailing blur sends no PATCH", async () => {
    const spy = okFetch();
    render(<OrgHierarchyManager initialUnits={[dept]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Revenue Department" }));
    const input = screen.getByRole("textbox", { name: "Rename Revenue Department" });
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    await new Promise((r) => setTimeout(r, 20));
    expect(patches(spy)).toHaveLength(0);
  });

  it("clicking away (blur) with a changed name sends one PATCH", async () => {
    const spy = okFetch();
    render(<OrgHierarchyManager initialUnits={[dept]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Revenue Department" }));
    const input = screen.getByRole("textbox", { name: "Rename Revenue Department" });
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.blur(input);
    await waitFor(() => expect(patches(spy)).toHaveLength(1));
  });
});

// GAP-ADMIN-ORG-03
describe("OrgHierarchyManager move", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("selfAndDescendantIds covers the whole subtree", () => {
    expect([...selfAndDescendantIds([dept, division, section, other], "unit-dept-1")].sort()).toEqual(["unit-dept-1", "unit-div-1", "unit-sec-1"]);
  });

  it("offers neither the unit nor its descendants as a new parent, and PATCHes parentId only after Confirm", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "PATCH"
        ? new Response("{}", { status: 202 })
        : new Response(JSON.stringify({ data: [{ ...dept, parentId: "unit-dept-2" }, division, section, other] }), { status: 200 }),
    );
    render(<OrgHierarchyManager initialUnits={[dept, division, section, other]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Move Revenue Department" }));
    const dialog = screen.getByRole("alertdialog");
    const options = within(dialog).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["(top level)", "Works Department"]);
    expect(patches(spy)).toHaveLength(0);
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "unit-dept-2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    await waitFor(() => expect(patches(spy)).toHaveLength(1));
    expect(JSON.parse((patches(spy)[0]![1] as RequestInit).body as string)).toEqual({ parentId: "unit-dept-2" });
    // 202 is async: the user is told it was accepted, then the polled tree confirms it.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Move (accepted|applied)/));
  });

  it("a 202 whose result is not visible yet says so instead of silently showing the old tree", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) =>
        (init as RequestInit | undefined)?.method === "PATCH"
          ? new Response("{}", { status: 202 })
          : new Response(JSON.stringify({ data: [dept, division, section, other] }), { status: 200 }),
      );
      render(<OrgHierarchyManager initialUnits={[dept, division, section, other]} source="api" />);
      fireEvent.click(screen.getByRole("button", { name: "Move Revenue Department" }));
      const dialog = screen.getByRole("alertdialog");
      fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "unit-dept-2" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Move accepted — the tree updates shortly."));
      await vi.advanceTimersByTimeAsync(6000);
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/has not appeared yet/));
    } finally {
      vi.useRealTimers();
    }
  });

  it("a 409 HIERARCHY_CYCLE keeps the dialog open and explains why inside it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "HIERARCHY_CYCLE", message: "reparenting would create a cycle" }), { status: 409 }),
    );
    render(<OrgHierarchyManager initialUnits={[dept, division, section, other]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Move Revenue Department" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "unit-dept-2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByText(/one of its own sub-units/)).toBeInTheDocument());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByText("reparenting would create a cycle")).not.toBeInTheDocument();
  });
});

// GAP-ADMIN-ORG-04
describe("OrgHierarchyManager accessibility", () => {
  it("action buttons name their unit and a parent can be collapsed and expanded", () => {
    render(<OrgHierarchyManager initialUnits={[dept, division]} source="api" />);
    expect(screen.getByRole("button", { name: "Add child unit under Revenue Department" })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Collapse Revenue Department" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.queryByText("Assessment Division")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Revenue Department" })).toHaveAttribute("aria-expanded", "false");
  });
});

// GAP-ADMIN-ORG-05
describe("OrgHierarchyManager failure + validation", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("a failed load with no units shows retry, no 'No organisational units yet', and disables Add", () => {
    render(<OrgHierarchyManager initialUnits={[]} source="error" errorStatus={500} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/No organisational units yet/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add top-level unit" })).toBeDisabled();
  });

  it("an invalid code is rejected before any POST", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    render(<OrgHierarchyManager initialUnits={[dept]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add top-level unit" }));
    fireEvent.change(screen.getByLabelText("New unit name"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("New unit code"), { target: { value: "a b!" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Code may only contain/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a failed post-save refresh is reported, not swallowed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "POST" ? new Response("{}", { status: 202 }) : new Response("{}", { status: 500 }),
    );
    render(<OrgHierarchyManager initialUnits={[dept]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add top-level unit" }));
    fireEvent.change(screen.getByLabelText("New unit name"), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be refreshed/);
  });
});
