import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getPage = vi.hoisted(() => vi.fn());
vi.mock("../../../../_data/loaders", () => ({ getFinanceGLPage: (...a: unknown[]) => getPage(...a) }));
vi.mock("./GLTable", () => ({
  GLTable: (p: { view: unknown; entries: unknown[] }) => <div>gl-table {JSON.stringify(p.view)} rows={p.entries.length}</div>,
}));
vi.mock("../../_components/FyFilter", () => ({ FyFilter: () => <div>fy-filter</div> }));
vi.mock("../../_components/PrintExportButton", () => ({ PrintExportButton: () => null }));
vi.mock("../../_components/PrintHeader", () => ({ PrintHeader: () => null }));

import GeneralLedgerPage from "./page";

const OK = { source: "api", data: { entries: [{ id: "j:1" }], pagination: { limit: 25, offset: 0, total: 1, hasMore: false }, totals: null } };

describe("GeneralLedgerPage (GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03)", () => {
  beforeEach(() => { getPage.mockReset(); getPage.mockResolvedValue(OK); });

  it("fetches one bounded page for the chosen fy / type / search / page, never the whole ledger", async () => {
    render(await GeneralLedgerPage({ searchParams: { fy: "2025-26", type: "receipt", q: "V-1", page: "3" } }));
    expect(getPage).toHaveBeenCalledTimes(1);
    expect(getPage).toHaveBeenCalledWith({ fy: "2025-26", type: "receipt", q: "V-1", page: 3, pageSize: 25 });
    expect(screen.getByText("fy-filter")).toBeInTheDocument();
  });

  it("with no params it asks for the current fiscal year, page 1, all types", async () => {
    render(await GeneralLedgerPage({}));
    const arg = getPage.mock.calls[0]![0];
    expect(arg).toMatchObject({ page: 1, pageSize: 25, type: undefined, q: undefined });
    expect(arg.fy).toMatch(/^\d{4}-\d{2}$/);
  });

  it("a failed load is a retry / permission state, never an empty or balanced ledger", async () => {
    getPage.mockResolvedValue({ source: "error", status: 503, data: { entries: [], pagination: { limit: 25, offset: 0, total: 0, hasMore: false }, totals: null } });
    render(await GeneralLedgerPage({}));
    expect(screen.queryByText(/gl-table/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    getPage.mockResolvedValue({ source: "error", status: 403, data: OK.data });
    render(await GeneralLedgerPage({}));
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
  });

  it("announces a just-posted voucher", async () => {
    render(await GeneralLedgerPage({ searchParams: { posted: "JV-9", state: "queued" } }));
    expect(screen.getByRole("status")).toHaveTextContent(/JV-9 accepted for processing/);
  });
});
