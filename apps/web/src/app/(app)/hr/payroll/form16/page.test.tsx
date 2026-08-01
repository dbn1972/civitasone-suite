import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import Form16Page from "./page";

describe("Form16Page", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the bulk job status when one exists for the FY", async () => {
    fetchJsonMock.mockResolvedValue({
      data: {
        jobId: "job-1",
        fy: "2025-26",
        status: "completed",
        totalEmployees: 10,
        generated: 10,
        failed: 0,
        storagePrefix: "form16/2025-26",
        errorDetails: null,
        createdAt: "2026-04-01T00:00:00.000Z",
        completedAt: "2026-04-01T01:00:00.000Z",
      },
      source: "api",
    });

    const ui = await Form16Page({ searchParams: { fy: "2025-26" } });
    render(ui);

    expect(screen.getByText("job-1")).toBeInTheDocument();
    expect(screen.getByText("Total Employees")).toBeInTheDocument();
  });

  it("renders an empty state when no bulk job exists for the FY", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });

    const ui = await Form16Page({ searchParams: { fy: "2025-26" } });
    render(ui);

    expect(screen.getByText("No Form-16 filing run for FY 2025-26")).toBeInTheDocument();
  });
});
