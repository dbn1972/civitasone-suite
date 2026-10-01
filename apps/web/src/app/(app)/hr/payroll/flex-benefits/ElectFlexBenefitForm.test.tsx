import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ElectFlexBenefitForm, electionProblems } from "./ElectFlexBenefitForm";
import type { FlexPlan } from "./flexPlans";

// GAP-PAYROLL-FLEX-BENEFITS-01/03: the form is driven by the plan list
// (GET /flex-benefits/plans) -- pick a plan, then one capped amount per
// plan component; the total is capped at the plan budget.
const PLAN: FlexPlan = {
  id: "77777777-7777-4777-8777-777777777701",
  name: "Standard Flex",
  fy: "2026-27",
  totalBudgetMinor: "5000000",
  components: [
    { name: "Medical", maxMinor: "2000000", taxExempt: true },
    { name: "LTA", maxMinor: "4000000", taxExempt: true },
  ],
};

function renderForm(plans: FlexPlan[] = [PLAN]) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ElectFlexBenefitForm plans={plans} />
    </NextIntlClientProvider>,
  );
}

describe("electionProblems", () => {
  it("flags amounts above a component max and totals above the budget", () => {
    expect(electionProblems(PLAN, { Medical: "20000.01" }).lines).toEqual({ Medical: "overMax" });
    expect(electionProblems(PLAN, { Medical: "20000", LTA: "30000.01" }).overBudget).toBe(true);
    expect(electionProblems(PLAN, { Medical: "20000", LTA: "30000" })).toMatchObject({ overBudget: false, totalMinor: 5000000n });
    expect(electionProblems(PLAN, { Medical: "10.005" }).lines).toEqual({ Medical: "invalid" });
  });
});

describe("ElectFlexBenefitForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("has no hand-typed Plan ID or free-text component inputs", () => {
    renderForm();
    expect(screen.queryByLabelText(/Plan ID/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Component$/)).not.toBeInTheDocument();
  });

  it("requires a plan before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit Election" }));
    expect(screen.getByText("Choose a plan.")).toBeInTheDocument();
  });

  it("choosing a plan lists its components and blocks amounts above a component max", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Plan/), { target: { value: PLAN.id } });
    const medical = screen.getByLabelText(/^Medical/);
    expect(screen.getByLabelText(/^LTA/)).toBeInTheDocument();
    fireEvent.change(medical, { target: { value: "20000.01" } });
    expect(screen.getByText("Above this component's maximum of ₹20,000.00.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit Election" })).toBeDisabled();
  });

  it("a total above the plan budget disables submit with a message", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Plan/), { target: { value: PLAN.id } });
    fireEvent.change(screen.getByLabelText(/^Medical/), { target: { value: "20000" } });
    fireEvent.change(screen.getByLabelText(/^LTA/), { target: { value: "31000" } });
    expect(screen.getByText(/of the ₹50,000.00 plan budget/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit Election" })).toBeDisabled();
  });

  it("submits only the plan's components, in paise, with the plan's FY (202 envelope)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "el1", status: "accepted", correlationId: "c" }), { status: 202 }),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Plan/), { target: { value: PLAN.id } });
    fireEvent.change(screen.getByLabelText(/^Medical/), { target: { value: "15000.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Election" }));
    await waitFor(() => expect(screen.getByText("Submit this flex benefit election?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit election"));
    await waitFor(() => expect(document.querySelector(".pill.good")).toHaveTextContent("Election submitted: ₹15,000.50 elected."));
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({ planId: PLAN.id, fy: "2026-27", elections: [{ component: "Medical", electedMinor: 1500050 }] });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Plan/), { target: { value: PLAN.id } });
    fireEvent.change(screen.getByLabelText(/^Medical/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Election" }));
    await waitFor(() => expect(screen.getByText("Submit this flex benefit election?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit election"));
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
  });

  it("explains when no plan is available", () => {
    renderForm([]);
    expect(screen.getByText("No flex benefit plan is open for elections yet.")).toBeInTheDocument();
  });
});
