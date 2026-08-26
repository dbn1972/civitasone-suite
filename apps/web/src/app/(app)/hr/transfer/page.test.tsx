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
});
