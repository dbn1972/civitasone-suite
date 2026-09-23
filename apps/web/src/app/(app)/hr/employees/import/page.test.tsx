import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

import BulkImportPage from "./page";

async function renderPage() {
  const page = await BulkImportPage();
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{page}</NextIntlClientProvider>);
}

describe("BulkImportPage — role gating (Problem A)", () => {
  it("shows an honest permission-denied state for 'employee'", async () => {
    // Regression: ImportForm.tsx posts each row to POST /v1/hrms/employees,
    // which requires hr_admin/hr_officer/super_admin (employee/routes.ts).
    // Confirmed live for the sibling /hr/employees/new page.
    mockRoles = ["employee"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByText("Bulk Employee Import")).not.toBeInTheDocument();
  });

  it("renders the real bulk-import page for super_admin", async () => {
    mockRoles = ["super_admin"];
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByText("Bulk Employee Import")).toBeInTheDocument();
  });
});
