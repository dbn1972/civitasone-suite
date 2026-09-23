import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { DepartmentsTable } from "./DepartmentsTable";

const DEPTS = [{ id: "d1", code: "IT", name: "Information Technology", parentId: null, employeeCount: 5 }];

function renderTable(canEdit = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DepartmentsTable depts={DEPTS} canEdit={canEdit} />
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

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Save failed/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the generic 'Delete failed' literal, when deleting fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
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
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("renders Edit/Delete when canEdit is true", () => {
    renderTable(true);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});
