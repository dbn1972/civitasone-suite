import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }),
}));

import TransferPage from "./page";

describe("TransferPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("shows a genuine empty state -- not an error -- when the API legitimately returns zero transfers", async () => {
    // Regression test: this page used to re-fetch a second, nonexistent
    // endpoint whenever the first result's array was empty, and used that
    // guaranteed-error result instead -- turning a real "zero transfers"
    // success into a false error state. There must be exactly one fetchJson
    // call, and it must render as a real empty state.
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await TransferPage();
    render(ui);

    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No transfer orders")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
  });

  it("tells the truth on a real fetch failure instead of the old 'Showing saved information' copy", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await TransferPage();
    render(ui);

    expect(screen.getByText("Couldn't load transfer orders — showing nothing")).toBeInTheDocument();
  });

  it("falls back to raw ids instead of blank cells when the backend row has no joined names yet", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "t1", employeeId: "emp-42", fromDeptId: "dept-a", toDeptId: "dept-b", status: "pending" },
      ],
      source: "api",
    });

    const ui = await TransferPage();
    render(ui);

    expect(screen.getAllByText("emp-42").length).toBeGreaterThan(0);
  });

  // UX-01x: a 403 (this route is HR-role-gated -- see
  // services/hrms-service/src/modules/lifecycle/routes.ts's HR_ROLES guard
  // on GET /v1/hrms/lifecycle/transfers) used to render the exact same
  // "couldn't load, try again" panel as a real network failure. Retrying a
  // permanent authorization boundary can never succeed, so that was actively
  // misleading -- it must show the honest, specific reason instead.
  it("shows an honest 'Access restricted' message (not the generic retry message) when the backend returns 403", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [],
      source: "error",
      status: 403,
      errorMessage: "requires one of: hr_admin, hr_officer, super_admin",
    });

    const ui = await TransferPage();
    render(ui);

    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.getByText("Requires one of: hr_admin, hr_officer, super_admin.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("still shows the generic 'try again' message for a genuine transient failure (no status -- e.g. a network error)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await TransferPage();
    render(ui);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });
});
