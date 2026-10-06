import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../_data", () => ({ getCdpIdentityPage: vi.fn() }));

import Page from "./page";
import { getCdpIdentityPage } from "../_data";

const mocked = vi.mocked(getCdpIdentityPage);

beforeEach(() => mocked.mockReset());

describe("CDP identity page (GAP-CDP-IDENTITY-01/02)", () => {
  it("uses view-only copy, not 'pending identity resolution'", async () => {
    mocked.mockResolvedValue({ data: { rows: [], total: 0, limit: 50 }, source: "api" } as never);
    render(await Page({ searchParams: {} }));
    expect(screen.getByText(/view only/i)).toBeInTheDocument();
    expect(screen.queryByText(/pending identity resolution/i)).not.toBeInTheDocument();
  });

  it("renders Visitor/Device/Status/Last seen columns and no raw-id column", async () => {
    mocked.mockResolvedValue({
      data: { rows: [{ id: "3fa1c111-0000-4000-8000-000000000002", label: "a1b2c3d4e5f6", sublabel: "web", status: "anonymous", meta: "20 Aug 2026" }], total: 1, limit: 50 },
      source: "api",
    } as never);
    render(await Page({ searchParams: {} }));
    expect(screen.getByText("Visitor")).toBeInTheDocument();
    expect(screen.getByText("Last seen")).toBeInTheDocument();
    // the raw UUID fragment must not be visible
    expect(screen.queryByText("3fa1c111")).not.toBeInTheDocument();
    // status appears exactly once (not duplicated into a Detail column)
    expect(screen.getAllByText("anonymous")).toHaveLength(1);
  });

  it("shows the 'first 50 / more may exist' truncation via the pager line", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `v${i}`, label: `ref${i}` }));
    mocked.mockResolvedValue({ data: { rows, total: 120, limit: 50 }, source: "api" } as never);
    render(await Page({ searchParams: {} }));
    expect(screen.getByText(/Showing 1–50 of 120/)).toBeInTheDocument();
  });

  it("does not show a next page when all rows fit", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}`, label: `ref${i}` }));
    mocked.mockResolvedValue({ data: { rows, total: 12, limit: 50 }, source: "api" } as never);
    render(await Page({ searchParams: {} }));
    expect(screen.getByText(/Showing 1–12 of 12/)).toBeInTheDocument();
    expect(screen.getByLabelText("Next page")).toHaveAttribute("aria-disabled", "true");
  });
});
