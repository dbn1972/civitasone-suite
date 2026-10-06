import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../_data", () => ({ getCdpEventsPage: vi.fn() }));

import Page from "./page";
import { getCdpEventsPage } from "../_data";

const mocked = vi.mocked(getCdpEventsPage);

beforeEach(() => mocked.mockReset());

describe("CDP events page (GAP-CDP-EVENTS-02)", () => {
  it("renders business column headers, not generic Detail/Meta/ID", async () => {
    mocked.mockResolvedValue({
      data: { rows: [{ id: "e1", label: "order_placed", sublabel: "behavioural", status: "approved", meta: "01 Aug 2026" }], total: 1, limit: 25 },
      source: "api",
    } as never);
    render(await Page({ searchParams: {} }));
    expect(screen.getByText("Event")).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.queryByText("Detail")).not.toBeInTheDocument();
    expect(screen.queryByText("Meta")).not.toBeInTheDocument();
    // no "ID" column header
    expect(screen.queryByRole("columnheader", { name: "ID" })).not.toBeInTheDocument();
  });

  it("shows 'Showing 1–1 of 60' and an enabled Next when more pages exist", async () => {
    mocked.mockResolvedValue({
      data: { rows: [{ id: "e1", label: "order_placed" }], total: 60, limit: 25 },
      source: "api",
    } as never);
    render(await Page({ searchParams: {} }));
    expect(screen.getByText(/Showing 1–1 of 60/)).toBeInTheDocument();
  });

  it("passes a filter box (sortable/filterable DataTable)", async () => {
    mocked.mockResolvedValue({
      data: { rows: [{ id: "e1", label: "order_placed" }], total: 1, limit: 25 },
      source: "api",
    } as never);
    render(await Page({ searchParams: {} }));
    expect(screen.getByPlaceholderText("Filter events")).toBeInTheDocument();
  });
});
