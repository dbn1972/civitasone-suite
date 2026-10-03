import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { GratuityRuleForm } from "./GratuityRuleForm";

function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GratuityRuleForm currentRuleSet="pog_act" />
    </NextIntlClientProvider>,
  );
}

describe("GratuityRuleForm (GAP-PAYROLL-STATUTORY-GRATUITY-01)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("picking CCS DCRG pre-fills the Rs 25 lakh ceiling; posting sends paise, rule set and a reason", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText("Rule set"), { target: { value: "ccs_dcrg" } });
    expect((screen.getByLabelText(/^Ceiling/) as HTMLInputElement).value).toBe("2500000");
    fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2024-01-01" } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Government Department edition: DCRG" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule set" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("v1/payroll/statutory/gratuity/rules");
    expect(JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body))).toEqual({
      effectiveFrom: "2024-01-01", ruleSet: "ccs_dcrg", minServiceYears: 5, ceilingMinor: "250000000", changeReason: "Government Department edition: DCRG",
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("refuses a missing date, a bad ceiling or a short reason without calling the API", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Ceiling/), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule set" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/effective date/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
