import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const rolesMock = vi.fn<() => string[]>(() => []);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

const getTrainingPlansMock = vi.fn();
const getDepartmentsMock = vi.fn();
vi.mock("../_data", () => ({
  getTrainingPlans: (...a: unknown[]) => getTrainingPlansMock(...a),
  getDepartments: () => getDepartmentsMock(),
}));

import Page from "./page";

const DEPT_ID = "dept-123";

beforeEach(() => {
  rolesMock.mockReturnValue(["employee"]);
  getDepartmentsMock.mockResolvedValue({ data: [{ id: DEPT_ID, name: "Public Works" }], source: "api" });
  getTrainingPlansMock.mockResolvedValue({
    data: {
      data: [
        { id: "p1", title: "Dept Plan", planYear: 2026, departmentId: DEPT_ID, roleCode: null, status: "active" },
        { id: "p2", title: "Role Plan", planYear: 2025, departmentId: null, roleCode: "clerk", status: "draft" },
      ],
      total: 2,
    },
    source: "api",
  });
});

async function renderPage(searchParams: Record<string, string> = {}) {
  render(await Page({ searchParams }));
}

describe("Training plans list (GAP-LEARNING-TRAINING-PLANS-01/02/03/04/05)", () => {
  it("renders FY labels (not bare years)", async () => {
    await renderPage();
    expect(screen.getByText("FY 2026-27")).toBeInTheDocument();
    expect(screen.getByText("FY 2025-26")).toBeInTheDocument();
  });

  it("resolves departmentId to a name (TRAINING-PLANS-03)", async () => {
    await renderPage();
    expect(screen.getByText(/Dept: Public Works/)).toBeInTheDocument();
    expect(screen.getByText(/Role: clerk/)).toBeInTheDocument();
    // never prints the raw uuid
    expect(screen.queryByText(DEPT_ID)).toBeNull();
  });

  it("shows a '+ New plan' link only for HR (TRAINING-PLANS-02)", async () => {
    await renderPage();
    expect(screen.queryByRole("link", { name: /new plan/i })).toBeNull();

    rolesMock.mockReturnValue(["hr_admin"]);
    const r = await Page({ searchParams: {} });
    render(r);
    expect(screen.getByRole("link", { name: /new plan/i })).toHaveAttribute("href", "/learning/training-plans/new");
  });

  it("rows link to the detail page (TRAINING-PLANS-01)", async () => {
    await renderPage();
    const link = screen.getByRole("link", { name: /Dept Plan/ });
    expect(link.getAttribute("href")).toBe("/learning/training-plans/p1");
  });

  it("shows total count (TRAINING-PLANS-05)", async () => {
    await renderPage();
    expect(screen.getByText(/of 2 plans/)).toBeInTheDocument();
  });
});
