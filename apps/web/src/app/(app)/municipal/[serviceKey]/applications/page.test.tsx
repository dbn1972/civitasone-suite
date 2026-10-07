import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../_data/municipalApi", () => ({ fetchMunicipalList: vi.fn() }));

import Page from "./page";
import { fetchMunicipalList } from "../../_data/municipalApi";

const mocked = vi.mocked(fetchMunicipalList);

beforeEach(() => mocked.mockReset());

describe("Municipal per-service applications list page", () => {
  it("renders the resource label and citizen apply link for a service with a manifest (trade)", async () => {
    mocked.mockResolvedValue({
      data: { rows: [], meta: { page: 1, pageSize: 20, total: 0 } },
      source: "api",
    });
    render(await Page({ params: { serviceKey: "trade" } }));
    expect(screen.getByRole("heading", { name: /Trade Licence — Applications/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Citizen apply" })).toHaveAttribute(
      "href",
      "/citizen/services/trade-license/apply",
    );
    // GAP-...-APPLICATIONS-04: no gateway path in the rendered page.
    const { container } = render(await Page({ params: { serviceKey: "trade" } }));
    expect(container.textContent).not.toContain("/api/");
  });

  it("hides the citizen apply link for a service with no manifest (building)", async () => {
    mocked.mockResolvedValue({
      data: { rows: [], meta: { page: 1, pageSize: 20, total: 0 } },
      source: "api",
    });
    render(await Page({ params: { serviceKey: "building" } }));
    expect(screen.getByRole("heading", { name: /Building Plan — Applications/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Citizen apply" })).not.toBeInTheDocument();
  });

  it("shows a retry (RefreshErrorState), not an empty-state, on a 500 (APPLICATIONS-03)", async () => {
    mocked.mockResolvedValue({
      data: { rows: [], meta: { page: 1, pageSize: 20, total: 0 } },
      source: "error",
      status: 500,
    });
    render(await Page({ params: { serviceKey: "trade" } }));
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
    // No old role/gateway blame copy.
    const { container } = render(await Page({ params: { serviceKey: "trade" } }));
    expect(container.textContent).not.toMatch(/behind the gateway/i);
  });

  it("shows a permission message (no retry) on a 403 (APPLICATIONS-03)", async () => {
    mocked.mockResolvedValue({
      data: { rows: [], meta: { page: 1, pageSize: 20, total: 0 } },
      source: "error",
      status: 403,
    });
    render(await Page({ params: { serviceKey: "trade" } }));
    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();
  });

  it("shows 'Showing X–Y of N' and a working Next link (APPLICATIONS-01)", async () => {
    mocked.mockResolvedValue({
      data: {
        rows: Array.from({ length: 20 }).map((_, i) => ({
          id: `r${i}`,
          reference: `TL-${i}`,
          title: `Shop ${i}`,
          status: "submitted",
          updatedAt: "2026-03-04T10:00:00Z",
        })),
        meta: { page: 1, pageSize: 20, total: 214 },
      },
      source: "api",
    });
    render(await Page({ params: { serviceKey: "trade" }, searchParams: { page: "1" } }));
    expect(screen.getByText(/Showing 1–20 of 214/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next/i })).toHaveAttribute(
      "href",
      "/municipal/trade/applications?page=2",
    );
  });

  it("binds the status filter to ?status= and calls the API with it (APPLICATIONS-05)", async () => {
    mocked.mockResolvedValue({
      data: { rows: [], meta: { page: 1, pageSize: 20, total: 0 } },
      source: "api",
    });
    render(await Page({ params: { serviceKey: "trade" }, searchParams: { status: "approved" } }));
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({ serviceKey: "trade" }),
      expect.objectContaining({ status: "approved", page: 1 }),
    );
    const approvedTab = screen.getByRole("tab", { name: "approved" });
    expect(approvedTab).toHaveAttribute("aria-selected", "true");
  });
});
