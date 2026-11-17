import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/activation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/activation")>("@/lib/activation");
  return { ...actual, trackActivation: vi.fn() };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./setupSkipApi", () => ({ persistSkippedStep: vi.fn(async () => true), unskipStep: vi.fn(async () => true) }));

import { onboardingStepsFor } from "@civitasone/tenant-profile";
import { SetupWizard } from "./SetupWizard";
import { WIZARD_STEPS, PROFILE_WIZARD_STEPS, stepsForProfile, type StepStatus } from "@/lib/setupSteps";

function renderFor(code: string | null, label: string | null) {
  const steps = stepsForProfile([...WIZARD_STEPS, ...PROFILE_WIZARD_STEPS], onboardingStepsFor(code, true)).map((s) => ({ ...s, status: "todo" as StepStatus }));
  return render(
    <SetupWizard steps={steps} doneCount={0} totalCount={steps.length} progress={0} ready={false} resumeIndex={0}
      progressUnknown={false} sampleDataEnabled={false} profileLabel={label} />,
  );
}

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

describe("SetupWizard (B8 profile-aware)", () => {
  it("shows the resolved profile label when provided", () => {
    renderFor("govt_small_office", "Small government office");
    expect(screen.getByTestId("setup-profile")).toHaveTextContent("Small government office");
  });
  it("shows no profile line for a legacy tenant (unchanged)", () => {
    renderFor("govt_dept", null);
    expect(screen.queryByTestId("setup-profile")).not.toBeInTheDocument();
  });
  it("renders the DDO step only for govt_small_office", () => {
    const { unmount } = renderFor("govt_small_office", "Small government office");
    expect(screen.getByText("Set up your DDO and budget allotment")).toBeInTheDocument();
    unmount();
    renderFor("section8", "Section 8 company");
    expect(screen.queryByText("Set up your DDO and budget allotment")).not.toBeInTheDocument();
  });
  it("has no axe violations (colour contrast needs a real browser)", async () => {
    const axe = (await import("axe-core")).default;
    const { container } = renderFor("govt_small_office", "Small government office");
    const out = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(out.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
