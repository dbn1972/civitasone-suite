import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { BatchesList } from "./BatchesList";
import { mapBatches } from "@/lib/bulkScan/mappers";
import { BATCH, jsonResponse, renderIntl } from "./testHelpers";
import type { Paged, BatchView } from "@/lib/bulkScan/types";

const ready = (rows: unknown[]): { data: Paged<BatchView>; source: "api" } => ({ data: mapBatches({ data: rows, pagination: { hasMore: false, pageSize: 50 } })!, source: "api" });

describe("BatchesList", () => {
  const f = vi.fn();
  beforeEach(() => { f.mockReset(); vi.stubGlobal("fetch", f); });
  afterEach(() => vi.unstubAllGlobals());

  it("ready: progress bar with a text value, per-state counts with words, status pill, links", () => {
    f.mockResolvedValue(jsonResponse(200, { data: [BATCH], pagination: {} }));
    renderIntl(<BatchesList result={ready([{ ...BATCH, status: "completed", counts: { filed: 6 }, progress: { total: 6, settled: 6, percent: 100 } }])} />);
    const bar = screen.getByRole("progressbar", { name: "Progress of March scans" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-valuetext", "6 of 6 files processed (100%)");
    expect(screen.getByText(/Filed: 6/)).toBeInTheDocument();
    expect(screen.getAllByText("Completed").some((e) => e.classList.contains("pill"))).toBe(true);
    expect(screen.getByRole("link", { name: "March scans" })).toHaveAttribute("href", "/admin/bulk-scan/b1");
    expect(screen.getAllByRole("link", { name: "New batch" })[0]).toHaveAttribute("href", "/admin/bulk-scan/new");
  });

  it("shows each non-zero state group with a text label, so status is never colour only", () => {
    f.mockResolvedValue(jsonResponse(200, { data: [BATCH], pagination: {} }));
    renderIntl(<BatchesList result={ready([BATCH])} />);
    expect(screen.getByText(/Processing: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Needs review: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Failed: 1/)).toBeInTheDocument();
  });

  it("empty is an honest empty state, not an error", () => {
    renderIntl(<BatchesList result={ready([])} />);
    expect(screen.getByText("No batches yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a failed load is NOT shown as empty", () => {
    renderIntl(<BatchesList result={{ data: { items: [], page: { hasMore: false, pageSize: 0, total: null } }, source: "error", status: 500 }} />);
    expect(screen.queryByText("No batches yet")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("filtering by status refetches with that status; an empty filtered result has its own message", async () => {
    f.mockResolvedValue(jsonResponse(200, { data: [], pagination: { hasMore: false, pageSize: 50 } }));
    renderIntl(<BatchesList result={ready([BATCH])} />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0]![0]).toContain("status=completed");
    expect(await screen.findByText("No batches with this status")).toBeInTheDocument();
  });

  it("a refetch failure keeps the loaded rows and shows a retryable notice", async () => {
    f.mockResolvedValue(jsonResponse(500, {}));
    renderIntl(<BatchesList result={ready([BATCH])} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("The list could not be refreshed. Showing the last loaded batches.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "March scans" })).toBeInTheDocument();
  });

  it("name filter narrows the loaded rows", () => {
    renderIntl(<BatchesList result={ready([BATCH, { ...BATCH, id: "b2", name: "April scans", counts: { filed: 1 } }])} />);
    fireEvent.change(screen.getByLabelText("Batch name"), { target: { value: "april" } });
    expect(screen.queryByRole("link", { name: "March scans" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "April scans" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Batch name"), { target: { value: "zzz" } });
    expect(screen.getByText("No batch matches that name")).toBeInTheDocument();
  });

  it("renders in Hindi", () => {
    renderIntl(<BatchesList result={ready([])} />, "hi");
    expect(screen.getByText("अभी कोई बैच नहीं")).toBeInTheDocument();
  });
});
