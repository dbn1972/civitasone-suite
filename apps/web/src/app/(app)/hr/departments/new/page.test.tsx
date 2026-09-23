import { describe, it, expect, vi } from "vitest";
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

import NewDepartmentPage from "./page";

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NewDepartmentPage />
    </NextIntlClientProvider>,
  );
}

describe("NewDepartmentPage — role gating (Problem A)", () => {
  it("shows an honest permission-denied state for a role the backend would reject, instead of a live-but-doomed form", () => {
    // Regression: POST /v1/hrms/departments requires hr_admin/super_admin/admin
    // (masters-routes.ts) -- "employee" is admitted into /hr by layout.tsx but
    // was never checked here, so this exact form used to render fully and
    // only fail after submit.
    mockRoles = ["employee"];
    renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/code/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Add Department")).not.toBeInTheDocument();
  });

  it("renders the real Add Department form for hr_admin", () => {
    mockRoles = ["hr_admin"];
    renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    // "Add Department" text is ambiguous here (the page heading, a form-
    // internal heading, and the submit button all share it) — the Code
    // field is the unambiguous signal that the real form rendered, same
    // query AddDepartmentForm.test.tsx itself already uses.
    expect(screen.getByLabelText(/code/i)).toBeInTheDocument();
  });

  it("renders the real form for the generic 'admin' role (masters-routes.ts's HR_ROLES includes it)", () => {
    mockRoles = ["admin"];
    renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/code/i)).toBeInTheDocument();
  });

  it("denies hr_officer (masters-routes.ts's HR_ROLES deliberately excludes it, unlike most other HR write routes)", () => {
    mockRoles = ["hr_officer"];
    renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });
});
