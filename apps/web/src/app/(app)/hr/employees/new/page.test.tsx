import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import NewEmployeePage from "./page";

describe("NewEmployeePage — role gating (Problem A)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
  });

  it("shows an honest permission-denied state for 'employee' and never calls the data loaders", async () => {
    // Regression: POST /v1/hrms/employees requires hr_admin/hr_officer/
    // super_admin (employee/routes.ts) -- confirmed live that "employee"
    // used to see this full 3-department/designations/managers-backed
    // wizard render with a working submit button that the backend would
    // only reject after the fact.
    mockRoles = ["employee"];
    const page = await NewEmployeePage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{page}</NextIntlClientProvider>);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the real Add Employee wizard for hr_officer", async () => {
    mockRoles = ["hr_officer"];
    const page = await NewEmployeePage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{page}</NextIntlClientProvider>);
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByText("Add Employee")).toBeInTheDocument();
    expect(fetchJsonMock).toHaveBeenCalled();
  });

  it("denies a manager (not in employee/routes.ts's write-side HR_ROLES, only its READER_ROLES)", async () => {
    mockRoles = ["manager"];
    const page = await NewEmployeePage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{page}</NextIntlClientProvider>);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });
});
