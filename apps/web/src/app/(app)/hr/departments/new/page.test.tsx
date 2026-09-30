import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// Same mocking convention as hr/payroll/page.test.tsx: control the session
// role directly at the roleGuard module boundary rather than re-deriving it
// from a fake JWT cookie (that's roleGuard.test.ts's own concern).
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

// GAP-HR-DEPARTMENTS-03: the page now also fetches the department list
// server-side (for the "Add Department" form's parent select), same
// fetchJson-mocking convention as departments/page.test.tsx.
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import NewDepartmentPage from "./page";

// NewDepartmentPage is now an async Server Component (it awaits the
// department-list fetch before rendering) -- call and await it directly,
// same pattern departments/page.test.tsx already uses for its sibling page,
// rather than mounting it as a plain synchronous JSX element.
async function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await NewDepartmentPage()}
    </NextIntlClientProvider>,
  );
}

describe("NewDepartmentPage — role gating (Problem A)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
  });

  it("shows an honest permission-denied state for a role the backend would reject, instead of a live-but-doomed form", async () => {
    // Regression: POST /v1/hrms/departments requires hr_admin/super_admin/admin
    // (masters-routes.ts) -- "employee" is admitted into /hr by layout.tsx but
    // was never checked here, so this exact form used to render fully and
    // only fail after submit.
    mockRoles = ["employee"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/code/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Add Department")).not.toBeInTheDocument();
    // A role that can't even reach the form has no reason to pay for the
    // department-list fetch.
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the real Add Department form for hr_admin", async () => {
    mockRoles = ["hr_admin"];
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    // "Add Department" text is ambiguous here (the page heading, a form-
    // internal heading, and the submit button all share it) — the Code
    // field is the unambiguous signal that the real form rendered, same
    // query AddDepartmentForm.test.tsx itself already uses.
    expect(screen.getByLabelText(/code/i)).toBeInTheDocument();
  });

  it("renders the real form for the generic 'admin' role (masters-routes.ts's HR_ROLES includes it)", async () => {
    mockRoles = ["admin"];
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/code/i)).toBeInTheDocument();
  });

  it("denies hr_officer (masters-routes.ts's HR_ROLES deliberately excludes it, unlike most other HR write routes)", async () => {
    mockRoles = ["hr_officer"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });

  it("passes the fetched department list through to the parent-department select", async () => {
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "d1", code: "FIN", name: "Finance", parentId: null }],
      source: "api",
    });
    await renderPage();
    expect(screen.getByRole("option", { name: /FIN · Finance/ })).toBeInTheDocument();
  });

  it("still renders the form (parent select just offers no options) when the department-list fetch fails", async () => {
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByLabelText(/code/i)).toBeInTheDocument();
  });
});
