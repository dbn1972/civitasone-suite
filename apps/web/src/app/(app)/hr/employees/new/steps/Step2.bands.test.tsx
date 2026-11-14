import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { Step2 } from "./Step2";
import { WIZARD_INIT } from "../wizardTypes";
import type { GradeBand } from "@/lib/gradeBands";

const BAND: GradeBand = { id: "b1", code: "T3", name: "Technical Lead", rank: 30, track: null, ctcMinMinor: null, ctcMaxMinor: null, noticeDays: null, isActive: true, version: 1 };
const DESIGNATIONS = [
  { id: "des-band", name: "Senior Engineer", level: 40, gradeBandId: "b1" },
  { id: "des-nobd", name: "Intern", level: 12, gradeBandId: null },
  { id: "des-l11", name: "Section Officer", level: 11, gradeBandId: null },
];

function renderStep(designationId: string, props: { payScale?: "cpc7" | "private_bands" } = {}) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Step2
        data={{ ...WIZARD_INIT, designationId }} errors={{}} departments={[{ id: "dep1", name: "Finance" }]}
        designations={DESIGNATIONS} gradeBands={[BAND]} onChange={onChange} onBlur={vi.fn()} {...props}
      />
    </NextIntlClientProvider>,
  );
  return onChange;
}

describe("Step2 grade field (S8-G4)", () => {
  it("private bands: shows the designation's band, never Group A/B/C, and sets the service grade to the band code", () => {
    const onChange = renderStep("des-band", { payScale: "private_bands" });
    expect(screen.getByText("Grade band")).toBeInTheDocument();
    expect(screen.getByText("T3 — Technical Lead")).toBeInTheDocument();
    expect(screen.getByText(/taken from the selected designation's grade band/i)).toBeInTheDocument();
    expect(screen.queryByText(/Group [ABC]/)).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith("grade", "T3");
  });

  it("private bands: a level-12 designation with no band shows no Group A and says no band is set", () => {
    const onChange = renderStep("des-nobd", { payScale: "private_bands" });
    expect(screen.getByText(/no grade band is set on this designation/i)).toBeInTheDocument();
    expect(screen.queryByText("Group A")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith("grade", expect.stringMatching(/Group/));
  });

  it("government tenant (default): a level-11 designation still shows the computed Group A, with no band wording", () => {
    const onChange = renderStep("des-l11");
    expect(screen.getByText("Group A")).toBeInTheDocument();
    expect(screen.queryByText("Grade band")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith("grade", "Group-A");
  });

  it("government tenant: even a designation that happens to carry a band keeps the level-derived group", () => {
    renderStep("des-band", { payScale: "cpc7" });
    expect(screen.queryByText("T3 — Technical Lead")).not.toBeInTheDocument();
  });
});
