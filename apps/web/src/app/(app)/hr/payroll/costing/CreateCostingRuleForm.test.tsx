import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateCostingRuleForm, parseSplitPct } from "./CreateCostingRuleForm";
import type { CostingRule } from "./costingShared";

const CC = { id: "11111111-1111-1111-1111-111111111111", code: "CC-01", name: "Schools" };
const CC2 = { id: "22222222-2222-2222-2222-222222222222", code: "CC-02", name: "Health" };

function renderForm(props: Partial<React.ComponentProps<typeof CreateCostingRuleForm>> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateCostingRuleForm costCenters={[CC, CC2]} costCentersAvailable rules={[]} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("CreateCostingRuleForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires employee group and cost center before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByText("Save Rule"));
    expect(screen.getByText("Employee group and cost center are required.")).toBeInTheDocument();
  });

  it("offers cost centres from the master list only -- no free-typed UUID box (COSTING-02)", () => {
    renderForm();
    const select = screen.getByLabelText(/^Cost Center/) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "CC-01 — Schools" })).toBeInTheDocument();
  });

  it("shows the group's running total and warns when it is not 100% (COSTING-02)", () => {
    const rules: CostingRule[] = [{ id: "r1", employeeGroup: "Teachers", costCenterId: CC2.id, splitPct: 60, status: "active" }];
    renderForm({ rules });
    fireEvent.change(screen.getByLabelText(/Employee Group/), { target: { value: "Teachers" } });
    fireEvent.change(screen.getByLabelText(/^Cost Center/), { target: { value: CC.id } });
    fireEvent.change(screen.getByLabelText(/Split %/), { target: { value: "30" } });
    expect(screen.getByText("Teachers will total 90% after this save (must be 100%).")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Split %/), { target: { value: "40" } });
    expect(screen.getByText("Teachers will total 100%.")).toBeInTheDocument();
  });

  it("rejects a split outside 0-100 (COSTING-02)", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Employee Group/), { target: { value: "Teachers" } });
    fireEvent.change(screen.getByLabelText(/^Cost Center/), { target: { value: CC.id } });
    fireEvent.change(screen.getByLabelText(/Split %/), { target: { value: "120" } });
    fireEvent.click(screen.getByText("Save Rule"));
    expect(screen.getByText(/Split % must be more than 0 and at most 100/)).toBeInTheDocument();
    expect(parseSplitPct("0")).toBeNull();
    expect(parseSplitPct("33.33")).toBe(33.33);
    expect(parseSplitPct("33.333")).toBeNull();
  });

  it("disables saving when the cost-centre master could not be loaded", () => {
    renderForm({ costCenters: [], costCentersAvailable: false });
    expect(screen.getByText(/Cost centers couldn't be loaded/)).toBeInTheDocument();
    expect(screen.getByText("Save Rule").closest("button")).toBeDisabled();
  });

  it("saves a costing rule on confirm using the submitted values (the API answers 202 with no rule body)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cmd-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/Employee Group/), { target: { value: "Group A" } });
    fireEvent.change(screen.getByLabelText(/^Cost Center/), { target: { value: CC.id } });
    fireEvent.click(screen.getByText("Save Rule"));

    await waitFor(() => expect(screen.getByText("Save this costing rule?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save rule"));

    await waitFor(() => {
      expect(screen.getByText("Costing rule saved for Group A (100%).")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ employeeGroup: "Group A", costCenterId: CC.id, splitPct: 100 });
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/Employee Group/), { target: { value: "Group A" } });
    fireEvent.change(screen.getByLabelText(/^Cost Center/), { target: { value: CC.id } });
    fireEvent.click(screen.getByText("Save Rule"));

    await waitFor(() => expect(screen.getByText("Save this costing rule?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save rule"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
