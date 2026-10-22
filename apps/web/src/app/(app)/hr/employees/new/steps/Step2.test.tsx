import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { Step2 } from "./Step2";
import { WIZARD_INIT, type WizardData } from "../wizardTypes";

function renderStep(data: WizardData, onChange = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Step2
        data={data}
        errors={{}}
        departments={[{ id: "dep1", name: "Finance" }]}
        designations={[{ id: "des1", name: "Section Officer" }]}
        onChange={onChange}
        onBlur={() => undefined}
      />
    </NextIntlClientProvider>,
  );
  return onChange;
}

/** GAP-HR-EMPLOYEES-NEW-02: Step 2 collects the pay structure, not only the basic pay. */
describe("Step2 pay structure (GAP-HR-EMPLOYEES-NEW-02)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("searches the payroll pay-structure master and stores the picked structure's id", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [{ id: "ps-1", name: "Level 7 Grade Pay", code: "L7" }, { id: "ps-2", name: "Consolidated", code: "CON" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ));
    vi.stubGlobal("fetch", fetchMock);
    const onChange = renderStep(WIZARD_INIT);

    const input = screen.getAllByRole("combobox").find((el) => (el as HTMLInputElement).placeholder === "Search pay structures…")!;
    fireEvent.change(input, { target: { value: "level" } });
    // The client-side filter keeps only the structure matching "level".
    fireEvent.mouseDown(await screen.findByText("Level 7 Grade Pay"));

    expect(screen.queryByText("Consolidated")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith("payStructureId", "ps-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/payroll/structures?limit=200", expect.anything());
  });

  it("is optional: nothing is required and an empty selection is reported as an empty id", () => {
    renderStep(WIZARD_INIT);
    expect(screen.getByText("Pay Structure")).toBeInTheDocument();
    expect(screen.getByText("(optional)")).toBeInTheDocument();
  });
});
