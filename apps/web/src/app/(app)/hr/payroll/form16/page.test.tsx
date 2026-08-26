import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const statusAwareGetMock = vi.fn();
vi.mock("../_lib/statusAwareFetch", () => ({
  statusAwareGet: (...args: unknown[]) => statusAwareGetMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import Form16Page from "./page";

describe("Form16Page", () => {
  beforeEach(() => {
    statusAwareGetMock.mockReset();
  });

  it("renders the bulk job status when one exists for the FY", async () => {
    statusAwareGetMock.mockResolvedValue({
      kind: "ok",
      status: 200,
      body: {
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
      },
    });

    const ui = await Form16Page({ searchParams: { fy: "2025-26" } });
    render(ui);

    expect(screen.getByText("job-1")).toBeInTheDocument();
    expect(screen.getByText("Total Employees")).toBeInTheDocument();
  });

  it("renders a legitimate empty state on a 404 (no job created yet)", async () => {
    statusAwareGetMock.mockResolvedValue({ kind: "http_error", status: 404, body: { code: "NOT_FOUND" } });

    const ui = await Form16Page({ searchParams: { fy: "2025-26" } });
    render(ui);

    expect(screen.getByText("No Form-16 filing run for FY 2025-26")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  it("renders the error affordance (not the empty-state copy) on a real failure like 403", async () => {
    statusAwareGetMock.mockResolvedValue({ kind: "http_error", status: 403, body: { code: "FORBIDDEN" } });

    const ui = await Form16Page({ searchParams: { fy: "2025-26" } });
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    expect(screen.getByText("Could not load the Form-16 filing run for FY 2025-26")).toBeInTheDocument();
    expect(screen.queryByText("No Form-16 filing run for FY 2025-26")).not.toBeInTheDocument();
  });
});
