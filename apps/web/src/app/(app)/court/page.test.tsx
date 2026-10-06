import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("./_data/loaders", () => ({
  getCases: vi.fn(),
  getPendency: vi.fn(),
  getAnalytics: vi.fn(),
}));

import CourtHomePage from "./page";
import { getCases, getPendency, getAnalytics } from "./_data/loaders";

const mockedCases = vi.mocked(getCases);
const mockedPendency = vi.mocked(getPendency);
const mockedAnalytics = vi.mocked(getAnalytics);

function tileValue(label: string): string {
  // StatCard renders .lab (label) and .val (value) as siblings in a .stat.
  // Scope to the .lab element so a label word also present elsewhere (e.g.
  // "Pending" in the pendency breakdown) doesn't cause a multiple match.
  const labelEl = screen.getByText((t, el) => el?.className === "lab" && t === label);
  const stat = labelEl.closest(".stat") as HTMLElement;
  return within(stat).getByText((_t, el) => el?.className === "val").textContent ?? "";
}

describe("CourtHomePage", () => {
  beforeEach(() => {
    mockedCases.mockReset();
    mockedPendency.mockReset();
    mockedAnalytics.mockReset();
  });

  it("sources Total Cases and Disposed from analytics (not the capped case list)", async () => {
    // The case list has only 2 rows (capped) and NO disposed rows, but
    // analytics reports 250 instituted / 90 disposed — the KPIs must follow
    // analytics so they agree with the Clearance Rate (HOME-01/02).
    mockedCases.mockResolvedValue({
      data: [
        { id: "c1", status: "pending" } as never,
        { id: "c2", status: "pending" } as never,
      ],
      source: "api",
    } as never);
    mockedPendency.mockResolvedValue({
      data: { summary: [{ status: "pending", count: 5 }, { status: "reserved", count: 2 }], total: 7 },
      source: "api",
    } as never);
    mockedAnalytics.mockResolvedValue({
      data: { instituted: 250, disposed: 90, clearanceRatePct: 36 },
      source: "api",
    } as never);

    render(await CourtHomePage());

    expect(tileValue("Total Cases")).toBe("250");
    expect(tileValue("Disposed")).toBe("90");
    expect(tileValue("Pending")).toBe("7");
    expect(tileValue("Clearance Rate")).toBe("36%");
    expect(screen.queryByText(/couldn't be loaded/i)).not.toBeInTheDocument();
  });

  it("shows '—' for Total Cases and Disposed when analytics fails, plus the badge", async () => {
    mockedCases.mockResolvedValue({
      data: [{ id: "c1", status: "disposed" } as never],
      source: "api",
    } as never);
    mockedPendency.mockResolvedValue({
      data: { summary: [], total: 3 },
      source: "api",
    } as never);
    mockedAnalytics.mockResolvedValue({
      data: { instituted: 0, disposed: 0, clearanceRatePct: null },
      source: "error",
    } as never);

    render(await CourtHomePage());

    expect(tileValue("Total Cases")).toBe("—");
    expect(tileValue("Disposed")).toBe("—");
    expect(tileValue("Clearance Rate")).toBe("—");
    // Pending still loaded fine.
    expect(tileValue("Pending")).toBe("3");
    expect(screen.getByText(/couldn't be loaded/i)).toBeInTheDocument();
  });

  it("renders the pendency breakdown rows summing to the total (HOME-03)", async () => {
    mockedCases.mockResolvedValue({ data: [], source: "api" } as never);
    mockedPendency.mockResolvedValue({
      data: { summary: [{ status: "pending", count: 5 }, { status: "reserved", count: 2 }], total: 7 },
      source: "api",
    } as never);
    mockedAnalytics.mockResolvedValue({
      data: { instituted: 7, disposed: 0, clearanceRatePct: 0 },
      source: "api",
    } as never);

    render(await CourtHomePage());

    const breakdown = screen.getByText("Pendency by status").closest(".card") as HTMLElement;
    expect(within(breakdown).getByText("Pending")).toBeInTheDocument();
    expect(within(breakdown).getByText("Reserved")).toBeInTheDocument();
    expect(within(breakdown).getByText("5")).toBeInTheDocument();
    expect(within(breakdown).getByText("2")).toBeInTheDocument();
  });

  it("does not render the pendency breakdown when pendency failed", async () => {
    mockedCases.mockResolvedValue({ data: [], source: "api" } as never);
    mockedPendency.mockResolvedValue({ data: { summary: [], total: 0 }, source: "error" } as never);
    mockedAnalytics.mockResolvedValue({
      data: { instituted: 1, disposed: 0, clearanceRatePct: 0 },
      source: "api",
    } as never);

    render(await CourtHomePage());

    expect(screen.queryByText("Pendency by status")).not.toBeInTheDocument();
    expect(tileValue("Pending")).toBe("—");
  });
});
