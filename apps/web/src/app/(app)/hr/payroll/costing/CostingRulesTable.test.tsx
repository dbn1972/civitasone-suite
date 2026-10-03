import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { CostingRulesTable, parseSplit, type RuleRow } from "./CostingRulesTable";
import type { CostingRule } from "./costingShared";

const RULES: CostingRule[] = [
  { id: "r1", employeeGroup: "Admin", costCenterId: "c1", splitPct: 60, status: "active" },
  { id: "r2", employeeGroup: "Admin", costCenterId: "c2", splitPct: 30, status: "active" },
  { id: "r3", employeeGroup: "Admin", costCenterId: "c3", splitPct: 20, status: "inactive" },
];
const ROWS: RuleRow[] = RULES.map((r, i) => ({
  id: r.id, employeeGroup: r.employeeGroup, costCenterLabel: `CC${i + 1} — Centre ${i + 1}`,
  splitPct: r.splitPct, splitPctLabel: `${r.splitPct}%`, groupTotalLabel: "90% (must be 100%)", status: r.status,
}));

function renderTable(canAdminister = true) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CostingRulesTable rows={ROWS} rules={RULES} canAdminister={canAdminister} />
    </NextIntlClientProvider>,
  );
}

describe("CostingRulesTable (GAP-PAYROLL-COSTING-02)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); refreshMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("parseSplit: 0 < split <= 100, at most 2 decimals", () => {
    expect(parseSplit("33.33")).toBe(33.33);
    expect(parseSplit("100")).toBe(100);
    for (const bad of ["0", "-1", "100.01", "33.333", "abc", ""]) expect(parseSplit(bad)).toBeNull();
  });

  it("a read-only viewer sees the rules but no actions", () => {
    renderTable(false);
    expect(screen.getByText("CC1 — Centre 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit split|Deactivate|Reactivate/ })).not.toBeInTheDocument();
  });

  it("active rules offer Edit + Deactivate; inactive rules offer Reactivate only", () => {
    renderTable();
    expect(screen.getByRole("button", { name: "Edit split % for Admin, CC1 — Centre 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate rule for Admin, CC2 — Centre 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivate rule for Admin, CC3 — Centre 3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit split % for Admin, CC3 — Centre 3" })).not.toBeInTheDocument();
  });

  it("edit previews the group total, blocks an invalid split, and PATCHes the new split", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: "x", status: "accepted", correlationId: "c" }), { status: 202 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Edit split % for Admin, CC1 — Centre 1" }));
    const dialog = await screen.findByRole("alertdialog");
    // other active = 30; 60 -> 70 gives 100
    fireEvent.change(within(dialog).getByLabelText("Split %"), { target: { value: "70" } });
    expect(dialog).toHaveTextContent("Admin will total 100% after this change.");
    fireEvent.change(within(dialog).getByLabelText("Split %"), { target: { value: "80" } });
    expect(dialog).toHaveTextContent("would total 110% — more than 100%");
    fireEvent.change(within(dialog).getByLabelText("Split %"), { target: { value: "33.333" } });
    expect(within(dialog).getByRole("button", { name: "Save split" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Split %"), { target: { value: "70" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save split" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/payroll/costing/rules/r1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ splitPct: 70 });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("deactivate and reactivate send only the status", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: "x", status: "accepted", correlationId: "c" }), { status: 202 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate rule for Admin, CC2 — Centre 2" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ status: "inactive" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Reactivate rule for Admin, CC3 — Centre 3" }));
    // 90 + 20 = 110 is previewed as over 100 (the server decides)
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("would total 110%");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reactivate" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toEqual({ status: "active" });
  });

  it("shows the server's refusal (422 over 100%) in the dialog and does not refresh", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ code: "COSTING_SPLIT_EXCEEDS_100", message: "this change would take employee group \"Admin\" above 100%" }), { status: 422 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Edit split % for Admin, CC1 — Centre 1" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Save split" }));
    await waitFor(() => expect(screen.getByText(/this would take Admin above 100%/)).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
