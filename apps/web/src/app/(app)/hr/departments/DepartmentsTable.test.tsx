import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DepartmentsTable } from "./DepartmentsTable";

const DEPTS = [{ id: "d1", code: "IT", name: "Information Technology", parentId: null, employeeCount: 5 }];

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
    render(<DepartmentsTable depts={DEPTS} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Save failed/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the generic 'Delete failed' literal, when deleting fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    render(<DepartmentsTable depts={DEPTS} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: /delete department/i }));

    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent(/couldn't save/i));
    expect(screen.getByRole("alertdialog").textContent).not.toMatch(/^Delete failed/);
  });
});
