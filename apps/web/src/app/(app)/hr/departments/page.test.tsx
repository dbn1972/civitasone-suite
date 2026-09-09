import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import DepartmentsPage from "./page";

const MOCK_DEPTS = [{ id: "d1", code: "FIN", name: "Finance", parentId: null }];

describe("DepartmentsPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders departments and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_DEPTS, source: "api" });
    render(await DepartmentsPage());
    expect(screen.getAllByText("Total Departments").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no departments", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await DepartmentsPage());
    expect(screen.getByText("No departments yet")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await DepartmentsPage());
    expect(screen.getByText("We couldn't load this departments.")).toBeInTheDocument();
    expect(screen.queryByText("No departments yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
