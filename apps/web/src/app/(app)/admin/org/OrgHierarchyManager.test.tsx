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
    // The page's own read of the user directory (head-of-unit names) is a GET; the claim is that nothing is POSTed.
    expect(spy.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
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

// GAP-ADMIN-ORG-03: head of unit + deactivate
describe("OrgHierarchyManager head of unit and deactivate (GAP-ADMIN-ORG-03)", () => {
  beforeEach(() => vi.restoreAllMocks());
  const USERS = [{ id: "11111111-1111-4111-8111-111111111111", name: "Asha Rao" }, { id: "22222222-2222-4222-8222-222222222222", name: "Vikram Shah" }];
  const headed: AdminOrgUnit = { ...division, headUserId: USERS[0]!.id };
  const usersOk = () => new Response(JSON.stringify({ data: USERS }), { status: 200 });

  it("shows the head by NAME, never the raw id", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => usersOk());
    render(<OrgHierarchyManager initialUnits={[dept, headed]} source="api" />);
    await waitFor(() => expect(screen.getByText(/Head: Asha Rao/)).toBeInTheDocument());
    expect(screen.queryByText(USERS[0]!.id)).not.toBeInTheDocument();
  });

  it("an unreachable user directory shows 'Unknown user', not an id, and the tree still works", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    render(<OrgHierarchyManager initialUnits={[dept, headed]} source="api" />);
    await waitFor(() => expect(screen.getByText(/Head: Unknown user/)).toBeInTheDocument());
    expect(screen.getByText("Revenue Department")).toBeInTheDocument();
  });

  it("Set head PATCHes headUserId only after Save, with the chosen person", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "PATCH" ? new Response("{}", { status: 202 }) : usersOk());
    render(<OrgHierarchyManager initialUnits={[dept, division]} source="api" />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Set head of Assessment Division" }));
    const dialog = screen.getByRole("alertdialog");
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "Asha Rao" })).toBeInTheDocument());
    expect(within(dialog).getByRole("button", { name: "Save head" })).toBeDisabled();
    expect(patches(spy)).toHaveLength(0);
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: USERS[1]!.id } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save head" }));
    await waitFor(() => expect(patches(spy)).toHaveLength(1));
    expect(JSON.parse((patches(spy)[0]![1] as RequestInit).body as string)).toEqual({ headUserId: USERS[1]!.id });
  });

  it("Deactivate requires a reason, POSTs it once, and says the unit is kept for history", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) =>
      (init as RequestInit | undefined)?.method === "POST" ? new Response("{}", { status: 202 }) : String(url).includes("/users") ? usersOk() : new Response(JSON.stringify({ data: [dept, { ...section, effectiveTo: "2026-01-01T00:00:00Z" }] }), { status: 200 }));
    render(<OrgHierarchyManager initialUnits={[dept, section]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Audit Section" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/history is kept/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Deactivate" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Merged into Accounts" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(spy.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toHaveLength(1));
    const post = spy.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    expect(post[0]).toBe(`${ORG}/unit-sec-1/deactivate`);
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ reason: "Merged into Accounts" });
  });

  it("a unit with active sub-units cannot be confirmed for deactivation, and says how many", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => usersOk());
    render(<OrgHierarchyManager initialUnits={[dept, division, section]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Assessment Division" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/still has 1 active sub-unit/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "reason given anyway" } });
    expect(within(dialog).getByRole("button", { name: "Deactivate" })).toBeDisabled();
  });

  it("a 409 from the server is explained in plain language inside the dialog", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) =>
      (init as RequestInit | undefined)?.method === "POST"
        ? new Response(JSON.stringify({ error: { code: "HAS_ACTIVE_CHILDREN" } }), { status: 409 })
        : usersOk());
    render(<OrgHierarchyManager initialUnits={[dept, section]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Audit Section" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "closing it down" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent(/still has active sub-units/));
  });

  it("an inactive unit is marked, dimmed out of the move picker and offers no actions", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => usersOk());
    const dead: AdminOrgUnit = { ...other, effectiveTo: "2026-01-01T00:00:00Z" };
    render(<OrgHierarchyManager initialUnits={[dept, dead]} source="api" />);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deactivate Works Department" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move Revenue Department" }));
    expect(within(screen.getByRole("alertdialog")).queryByRole("option", { name: "Works Department" })).not.toBeInTheDocument();
  });
});

describe("OrgHierarchyManager copy and positions override (reviewer follow-up)", () => {
  beforeEach(() => vi.restoreAllMocks());
  const usersOk = () => new Response(JSON.stringify({ data: [] }), { status: 200 });

  it("the head dialog does not claim approval routing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => usersOk());
    render(<OrgHierarchyManager initialUnits={[dept, division]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Set head of Assessment Division" }));
    const text = screen.getByRole("alertdialog").textContent ?? "";
    expect(text).toMatch(/for display and reporting/);
    expect(text).toMatch(/does not by itself change who approves/);
    expect(text).not.toMatch(/route to/);
  });

  it("a 409 HAS_ACTIVE_POSITIONS asks for an explicit acknowledgement and resends with it", async () => {
    let call = 0;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if ((init as RequestInit | undefined)?.method !== "POST") return usersOk();
      call++;
      return call === 1 ? new Response(JSON.stringify({ error: { code: "HAS_ACTIVE_POSITIONS" } }), { status: 409 }) : new Response("{}", { status: 202 });
    });
    render(<OrgHierarchyManager initialUnits={[dept, section]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Audit Section" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "restructure" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent(/open positions/));
    const confirm = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Deactivate" });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("checkbox"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(spy.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toHaveLength(2));
    const second = spy.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST")[1]!;
    expect(JSON.parse((second[1] as RequestInit).body as string)).toEqual({ reason: "restructure", acknowledgePositions: true });
  });
});
