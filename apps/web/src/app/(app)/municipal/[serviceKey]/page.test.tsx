import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../_data/municipalApi", () => ({ fetchMunicipalList: vi.fn() }));

import Page from "./page";
import { fetchMunicipalList } from "../_data/municipalApi";
import type { MunicipalRecordRow } from "../_data/records";

const mocked = vi.mocked(fetchMunicipalList);
beforeEach(() => mocked.mockReset());

function row(status: string, i = 0): MunicipalRecordRow {
  return { id: `id${i}`, reference: `R-${i}`, title: `T${i}`, status, updatedAt: "2026-03-04T10:00:00Z" };
}

describe("Municipal service home page", () => {
  it("shows '—' for Total records and In progress and a retry on load error (SERVICEKEY-01)", async () => {
    mocked.mockResolvedValue({ data: { rows: [], meta: { page: 1, pageSize: 20, total: 0 } }, source: "error" });
    render(await Page({ params: { serviceKey: "trade" } }));
    const total = screen.getByText("Total records").closest(".stat");
    expect(total?.textContent).toContain("—");
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
    // No "API" stat card / Live-Unavailable wording any more (SERVICEKEY-03).
    expect(screen.queryByText("API")).not.toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("excludes terminal (rejected/cancelled/approved) and unknown from In progress (SERVICEKEY-02)", async () => {
    const rows = [row("submitted", 1), row("under_review", 2), row("rejected", 3), row("cancelled", 4), row("approved", 5), row("—", 6)];
    mocked.mockResolvedValue({ data: { rows, meta: { page: 1, pageSize: 20, total: rows.length } }, source: "api" });
    render(await Page({ params: { serviceKey: "trade" } }));
    const inProgress = screen.getByText("In progress").closest(".stat");
    expect(inProgress?.textContent).toContain("2"); // submitted + under_review only
  });

  it("labels In progress as page-scoped when total exceeds loaded rows (SERVICEKEY-02)", async () => {
    const rows = [row("submitted", 1)];
    mocked.mockResolvedValue({ data: { rows, meta: { page: 1, pageSize: 20, total: 214 } }, source: "api" });
    render(await Page({ params: { serviceKey: "trade" } }));
    expect(screen.getByText("In progress (this page)")).toBeInTheDocument();
  });

  it("renders no gateway path and no 'API' card on a healthy fetch (SERVICEKEY-03)", async () => {
    mocked.mockResolvedValue({ data: { rows: [], meta: { page: 1, pageSize: 20, total: 0 } }, source: "api" });
    const { container } = render(await Page({ params: { serviceKey: "trade" } }));
    expect(container.textContent).not.toContain("/api/");
    expect(screen.queryByText("API")).not.toBeInTheDocument();
    // Healthy empty fetch still shows 0, not "—".
    const total = screen.getByText("Total records").closest(".stat");
    expect(total?.textContent).toContain("0");
  });
});
