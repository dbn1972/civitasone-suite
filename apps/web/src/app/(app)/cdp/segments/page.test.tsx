import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../_data", async () => {
  const actual = await vi.importActual<typeof import("../_data")>("../_data");
  return { ...actual, getCdpSegmentList: vi.fn() };
});

import Page from "./page";
import { getCdpSegmentList } from "../_data";

const mocked = vi.mocked(getCdpSegmentList);

beforeEach(() => mocked.mockReset());

describe("CDP segments page (GAP-CDP-SEGMENTS-02/03)", () => {
  it("uses view-only copy agreeing with the hub tile", async () => {
    mocked.mockResolvedValue({ data: { rows: [], total: 0, limit: 25 }, source: "api" } as never);
    render(await Page({ searchParams: {} }));
    expect(screen.getByText("View audience segments for campaigns.")).toBeInTheDocument();
  });

  it("renders Members and Rule summary columns", async () => {
    mocked.mockResolvedValue({
      data: { rows: [{ id: "s1", name: "VIPs", members: "1,234", ruleSummary: "2 rules (AND)", status: "active", updatedAt: "01 Aug 2026" }], total: 1, limit: 25 },
      source: "api",
    } as never);
    render(await Page({ searchParams: {} }));
    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(screen.getByText("Rule summary")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("2 rules (AND)")).toBeInTheDocument();
  });

  it("shows '—' for a segment with a missing member count (never 0)", async () => {
    mocked.mockResolvedValue({
      data: { rows: [{ id: "s2", name: "New", members: "—", ruleSummary: "—", status: "paused", updatedAt: "—" }], total: 1, limit: 25 },
      source: "api",
    } as never);
    render(await Page({ searchParams: {} }));
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
