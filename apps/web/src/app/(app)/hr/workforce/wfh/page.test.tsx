import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import WFHPage from "./page";

const MOCK_REQUESTS = [
  { id: "w1", employeeId: "e1", employeeName: "Sunita Rao", department: "Finance", fromDate: "2026-08-18", toDate: "2026-08-19", days: "2", reason: "Project work", status: "approved" },
  { id: "w2", employeeId: "e2", employeeName: "Kartik Das", department: "IT", fromDate: "2026-08-20", toDate: "2026-08-20", days: "1", reason: "Travel", status: "pending" },
];

describe("WFHPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders WFH request list", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    render(await WFHPage());
    expect(screen.getByText("Sunita Rao")).toBeInTheDocument();
    expect(screen.getByText("Kartik Das")).toBeInTheDocument();
  });

  it("renders page heading with DoPT reference", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await WFHPage());
    expect(screen.getByRole("heading", { name: /work from home/i })).toBeInTheDocument();
    // "DoPT" also appears in the empty-state table message and the embedded
    // form's policy note; match the subtitle's specific wording to scope this
    // assertion to the page subtitle.
    expect(screen.getByText(/DoPT policy/i)).toBeInTheDocument();
  });

  it("renders stat cards for approved and pending counts", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    render(await WFHPage());
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("embeds the WFH request form", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await WFHPage());
    expect(screen.getByRole("form", { name: /work from home request form/i })).toBeInTheDocument();
  });

  it("shows DoPT policy note inside the form", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await WFHPage());
    expect(screen.getByText(/2 days per week/i)).toBeInTheDocument();
  });
});
