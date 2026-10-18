import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatIndianDate } from "@/lib/formatters";

const getInspectionByIdMock = vi.fn();
vi.mock("../../_data/loaders", () => ({
  getInspectionById: (...args: unknown[]) => getInspectionByIdMock(...args),
}));

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import InspectionDetailPage from "./page";

const ID = "11111111-2222-4333-8444-555555555555";

describe("InspectionDetailPage", () => {
  beforeEach(() => {
    getInspectionByIdMock.mockReset();
    notFoundMock.mockClear();
  });

  it("renders id, entity, status, formatted scheduled date and inspector ids", async () => {
    getInspectionByIdMock.mockResolvedValueOnce({
      source: "api",
      status: 200,
      data: {
        id: ID,
        entityId: "entity-77",
        state: "scheduled",
        scheduledDate: "2026-03-31",
        assignedInspectors: ["insp-a", "insp-b"],
      },
    });

    render(await InspectionDetailPage({ params: { id: ID } }));

    expect(getInspectionByIdMock).toHaveBeenCalledWith(ID);
    expect(screen.getByText(ID)).toBeInTheDocument();
    expect(screen.getByText("entity-77")).toBeInTheDocument();
    expect(screen.getByText("Status").nextElementSibling).toHaveTextContent("Scheduled");
    expect(screen.getByText(formatIndianDate("2026-03-31"))).toBeInTheDocument();
    expect(screen.getByText("insp-a, insp-b")).toBeInTheDocument();
  });

  it("calls notFound() on a 404", async () => {
    getInspectionByIdMock.mockResolvedValueOnce({ source: "error", status: 404, data: null });

    await expect(InspectionDetailPage({ params: { id: ID } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable error state, not the raw error, on a non-404 failure", async () => {
    getInspectionByIdMock.mockResolvedValueOnce({
      source: "error",
      status: 500,
      errorCode: "INTERNAL",
      errorMessage: "pg: connection refused at 10.0.0.5",
      data: null,
    });

    render(await InspectionDetailPage({ params: { id: ID } }));

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/connection refused|10\.0\.0\.5|INTERNAL/)).not.toBeInTheDocument();
    expect(screen.queryByText("Inspection ID")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
