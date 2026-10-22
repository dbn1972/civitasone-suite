import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { DepartmentsTable } from "./DepartmentsTable";

type TestDept = { id: string; code: string; name: string; parentId: string | null; employeeCount: number };

const DEPTS: TestDept[] = [{ id: "d1", code: "IT", name: "Information Technology", parentId: null, employeeCount: 5 }];

function renderTable(canEdit = true, depts: TestDept[] = DEPTS) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DepartmentsTable depts={depts} canEdit={canEdit} />
    </NextIntlClientProvider>,
  );
}

/**
 * UX-016: both save and delete used to throw a hardcoded "Save failed" /
 * "Delete failed" literal regardless of what the backend actually said, so
 * the clerk never learned anything real about the failure — the same class
 * of leak useFormError closes fleet-wide (UX-003), just with a static
 * literal standing in for the raw text/status this time.
 */
describe("DepartmentsTable — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the generic 'Save failed' literal, when saving fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderTable();

    // GAP-HR-DEPARTMENTS-07: Edit/Delete now carry an aria-label naming the
    // department ("Edit Information Technology") so a clerk working a long
    // list of same-named actions can tell rows apart by ear/screen-reader --
    // the accessible name is no longer the bare word "Edit".
    fireEvent.click(screen.getByRole("button", { name: /^Edit/ }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Save failed/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the generic 'Delete failed' literal, when deleting fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: /delete department/i }));

    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent(/couldn't save/i));
    expect(screen.getByRole("alertdialog").textContent).not.toMatch(/^Delete failed/);
  });
});

/**
 * HIGH finding: Edit/Delete used to render unconditionally regardless of
 * role, so a non-admin (e.g. hr_officer, who masters-routes.ts's backend
 * HR_ROLES deliberately excludes from PATCH/DELETE /v1/hrms/departments)
 * saw fully interactive buttons that always failed with a 403. The parent
 * page.tsx now computes canEdit from getSessionRoles() and passes it down.
 */
describe("DepartmentsTable — role-gated Edit/Delete", () => {
  it("does not render Edit/Delete when canEdit is false", () => {
    renderTable(false);
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it("renders Edit/Delete when canEdit is true", () => {
    renderTable(true);
    expect(screen.getByRole("button", { name: /^Edit/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Delete/ })).toBeInTheDocument();
  });
});

/**
 * GAP-HR-DEPARTMENTS-07: the expand/collapse toggle used to always render a
 * real <button>, with aria-label left `undefined` for a leaf row -- a
 * focusable control with no accessible name, showing an inert "·". A leaf
 * row now renders a plain decorative marker instead; only a row that
 * actually has children is a real, nameable button.
 */
describe("DepartmentsTable — leaf-row toggle accessibility (GAP-HR-DEPARTMENTS-07)", () => {
  const TREE_DEPTS: TestDept[] = [
    { id: "root", code: "GOV", name: "Government", parentId: null, employeeCount: 0 },
    { id: "child", code: "FIN", name: "Finance", parentId: "root", employeeCount: 3 },
    { id: "grandchild", code: "FINACC", name: "Accounts Wing", parentId: "child", employeeCount: 0 },
    { id: "other", code: "HR", name: "Human Resources", parentId: null, employeeCount: 0 },
  ];

  it("only renders a real toggle button for rows that actually have children", () => {
    renderTable(true, TREE_DEPTS);
    // "root" and "child" have children; "grandchild" and "other" are leaves.
    expect(screen.getAllByRole("button", { name: /collapse|expand/i })).toHaveLength(2);
  });
});

/**
 * GAP-HR-DEPARTMENTS-03: the inline edit row had no way to re-parent a
 * department at all (PATCH only ever sent {code, name}). A "Parent
 * department" select is now offered, excluding the department itself and
 * any of its own descendants (which would create a cycle the backend would
 * reject anyway -- this keeps the choice from being offered in the first
 * place).
 */
describe("DepartmentsTable — re-parent select (GAP-HR-DEPARTMENTS-03)", () => {
  const TREE_DEPTS: TestDept[] = [
    { id: "root", code: "GOV", name: "Government", parentId: null, employeeCount: 0 },
    { id: "child", code: "FIN", name: "Finance", parentId: "root", employeeCount: 3 },
    { id: "grandchild", code: "FINACC", name: "Accounts Wing", parentId: "child", employeeCount: 0 },
    { id: "other", code: "HR", name: "Human Resources", parentId: null, employeeCount: 0 },
  ];
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("excludes the department itself and its own descendants from the parent select", () => {
    renderTable(true, TREE_DEPTS);
    fireEvent.click(screen.getByRole("button", { name: "Edit Government" }));
    const select = screen.getByLabelText(/parent department/i);
    const optionNames = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(optionNames.some((t) => t?.includes("Government"))).toBe(false); // self
    expect(optionNames.some((t) => t?.includes("Finance"))).toBe(false);    // child
    expect(optionNames.some((t) => t?.includes("Accounts Wing"))).toBe(false); // grandchild
    expect(optionNames.some((t) => t?.includes("Human Resources"))).toBe(true); // unrelated, still eligible
  });

  it("sends the new parentId when a re-parent is saved", async () => {
    renderTable(true, TREE_DEPTS);
    fireEvent.click(screen.getByRole("button", { name: "Edit Accounts Wing" }));
    const select = screen.getByLabelText(/parent department/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent.parentId).toBe("other");
  });

  it("does not send parentId when the parent was left unchanged", async () => {
    renderTable(true, TREE_DEPTS);
    fireEvent.click(screen.getByRole("button", { name: "Edit Accounts Wing" }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent.parentId).toBeUndefined();
  });
});

/**
 * GAP-HR-DEPARTMENTS-02: the server now refuses (409) to delete a department
 * that still has children or employees; the row's Delete button stays
 * clickable either way (the 409's message is what tells the clerk why, via
 * the same formError-driven ConfirmDialog path already covered by the
 * UX-016 tests above) but carries an advisory title/aria-describedby hint
 * up front for a department that is currently in that state.
 */
describe("DepartmentsTable — delete-blocked advisory hint (GAP-HR-DEPARTMENTS-02)", () => {
  it("adds an advisory hint to Delete for a department with employees or children", () => {
    const depts = [{ id: "d1", code: "IT", name: "Information Technology", parentId: null, employeeCount: 5 }];
    renderTable(true, depts);
    expect(screen.getByRole("button", { name: /^Delete/ })).toHaveAttribute("title");
  });

  it("adds no advisory hint to Delete for an empty, childless department", () => {
    const depts = [{ id: "d1", code: "IT", name: "Information Technology", parentId: null, employeeCount: 0 }];
    renderTable(true, depts);
    expect(screen.getByRole("button", { name: /^Delete/ })).not.toHaveAttribute("title");
  });
});

/**
 * GAP-HR-DEPARTMENTS-01: a row the API sent no employeeCount for used to render
 * "0" (and an "0 employees" aria-label) -- a fabricated count that also made
 * delete look safe. Unknown now reads as an em dash with no count label.
 */
describe("DepartmentsTable — missing employeeCount is unknown, not zero (GAP-HR-DEPARTMENTS-01)", () => {
  function renderLoose(depts: Array<Record<string, unknown>>) {
    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <DepartmentsTable depts={depts as any} canEdit={true} />
      </NextIntlClientProvider>,
    );
  }

  it("renders an em dash, not 0, for a department without employeeCount, and no count aria-label", () => {
    const { container } = renderLoose([{ id: "d1", code: "IT", name: "Information Technology", parentId: null }]);
    expect(screen.getByTitle(/employee count unavailable/i)).toHaveTextContent("—");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(container.querySelector('[aria-label*="employee" i]')).toBeNull();
  });

  it("still renders a genuine zero as 0 with its label", () => {
    renderLoose([{ id: "d1", code: "IT", name: "Information Technology", parentId: null, employeeCount: 0 }]);
    expect(screen.getByLabelText("0 employees")).toHaveTextContent("0");
    expect(screen.queryByTitle(/employee count unavailable/i)).not.toBeInTheDocument();
  });

  it("renders a real count with a pluralised label", () => {
    renderLoose([{ id: "d1", code: "IT", name: "Information Technology", parentId: null, employeeCount: 1 }]);
    expect(screen.getByLabelText("1 employee")).toHaveTextContent("1");
  });
});

/**
 * GAP-HR-DEPARTMENTS-02 (acceptance 3): a 409 DEPARTMENT_IN_USE leaves the node
 * in the tree and tells the clerk why, in terms of departments -- not the
 * generic "changed by someone else" conflict copy.
 */
describe("DepartmentsTable — 409 DEPARTMENT_IN_USE keeps the node and explains (GAP-HR-DEPARTMENTS-02)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("leaves the department in the tree and shows the in-use message in the dialog", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ code: "DEPARTMENT_IN_USE", message: "This department still has sub-departments or employees assigned to it.", childCount: 0, employeeCount: 5 }),
        { status: 409 },
      ),
    );
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Delete Information Technology" }));
    fireEvent.click(await screen.findByRole("button", { name: /delete department/i }));

    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toHaveTextContent(/still has sub-departments or employees/i));
    expect(dialog).not.toHaveTextContent(/changed by someone else/i);
    expect(dialog.textContent).not.toMatch(/\b409\b/);
    // Still in the tree behind the dialog, and the delete was attempted exactly once.
    expect(screen.getByText("Information Technology")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("removes the node only after a successful delete", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Delete Information Technology" }));
    fireEvent.click(await screen.findByRole("button", { name: /delete department/i }));

    await waitFor(() => expect(screen.queryByText("Information Technology")).not.toBeInTheDocument());
  });
});

/**
 * GAP-HR-DEPARTMENTS-07: Hindi had no editAria / deleteAria (or the delete-
 * blocked hint, parent select labels), so a Hindi session fell back to the raw
 * key path for the per-row accessible names.
 */
describe("departmentsTable i18n — Hindi covers every English key (GAP-HR-DEPARTMENTS-07)", () => {
  it("has every key the English namespace has", () => {
    const missing = Object.keys(enMessages.departmentsTable).filter((k) => !(k in hiMessages.departmentsTable));
    expect(missing).toEqual([]);
  });

  it("renders the per-row Edit/Delete accessible names in Hindi, naming the department", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <DepartmentsTable depts={DEPTS} canEdit={true} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Information Technology संपादित करें" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Information Technology हटाएँ" })).toBeInTheDocument();
  });
});
