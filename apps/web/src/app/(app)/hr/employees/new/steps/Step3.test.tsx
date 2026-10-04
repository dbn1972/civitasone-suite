import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/entityAdapters/employee", () => ({ searchEmployees: vi.fn(async () => []), resolveEmployees: vi.fn(async () => []) }));
vi.mock("@/lib/entityAdapters/costCenter", () => ({ searchCostCenters: vi.fn(async () => []), resolveCostCenters: vi.fn(async () => []) }));
vi.mock("@/lib/entityAdapters/location", () => ({
  searchLocations: vi.fn(async () => [{ id: "loc-1", label: "CGO Complex", sublabel: "office · Delhi" }]),
  resolveLocations: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, label: "CGO Complex" }))),
}));

import { Step3 } from "./Step3";
import { WIZARD_INIT, type WizardData } from "../wizardTypes";

function renderStep(data: WizardData, onChange = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Step3 data={data} errors={{}} onChange={onChange} onBlur={() => undefined} />
    </NextIntlClientProvider>,
  );
  return onChange;
}

describe("Step3 work location (GAP-HR-LOCATIONS-03)", () => {
  it("picking a master location stores its id and its name as the display text", async () => {
    const onChange = renderStep(WIZARD_INIT);
    const input = screen.getAllByRole("combobox").find((el) => (el as HTMLInputElement).placeholder === "Search the location master")!;
    fireEvent.change(input, { target: { value: "CGO" } });
    fireEvent.mouseDown(await screen.findByText("CGO Complex"));
    expect(onChange).toHaveBeenCalledWith("locationId", "loc-1");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("workLocation", "CGO Complex"));
  });

  it("free text stays available for a place that is not in the master, and is locked while a master location is picked", () => {
    const onChange = renderStep({ ...WIZARD_INIT, workLocation: "" });
    const text = screen.getByLabelText(/not in the list/i);
    expect(text).not.toBeDisabled();
    fireEvent.change(text, { target: { value: "Field camp, Leh" } });
    expect(onChange).toHaveBeenCalledWith("workLocation", "Field camp, Leh");
  });

  it("the free-text box is disabled once a master location is chosen", () => {
    renderStep({ ...WIZARD_INIT, locationId: "loc-1", workLocation: "CGO Complex" });
    expect(screen.getByLabelText(/not in the list/i)).toBeDisabled();
  });
});

describe("Step3 state of employment (professional tax)", () => {
  it("is an optional select over the state list and reports the chosen code", () => {
    const onChange = renderStep(WIZARD_INIT);
    const sel = screen.getByLabelText("State of employment (for professional tax)") as HTMLSelectElement;
    expect(sel).toHaveValue("");
    expect(Array.from(sel.options).map((o) => o.value)).toContain("MH");
    fireEvent.change(sel, { target: { value: "MH" } });
    expect(onChange).toHaveBeenCalledWith("workStateCode", "MH");
  });
});
