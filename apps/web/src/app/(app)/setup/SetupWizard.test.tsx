import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Instrumentation is a fire-and-forget beacon — stub it so tests don't touch it.
vi.mock("@/lib/activation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/activation")>("@/lib/activation");
  return { ...actual, trackActivation: vi.fn() };
});

import { SetupWizard } from "./SetupWizard";
import { WIZARD_STEPS, type StepStatus } from "@/lib/setupSteps";

type StepView = (typeof WIZARD_STEPS)[number] & { status: StepStatus };

function stepViews(status: StepStatus = "todo"): StepView[] {
  return WIZARD_STEPS.map((s) => ({ ...s, status }));
}

function renderWizard(overrides: Partial<Parameters<typeof SetupWizard>[0]> = {}) {
  const steps = overrides.steps ?? stepViews();
  return render(
    <SetupWizard
      steps={steps}
      doneCount={0}
      totalCount={steps.length}
      progress={0}
      ready={false}
      resumeIndex={0}
      progressUnknown={false}
      sampleDataEnabled={false}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  // jsdom lacks scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("SetupWizard links (GAP-SETUP-HOME-02, -04)", () => {
  it("optional steps offer an honest 'Skip to dashboard', not 'Do it later' (GAP-02)", () => {
    renderWizard();
    expect(screen.queryByText(/Do it later/i)).toBeNull();
    const skip = screen.getAllByText(/Skip to dashboard/i)[0];
    expect(skip).toBeInTheDocument();
    expect(skip.closest("a")).toHaveAttribute("href", "/dashboard");
  });

  it("step CTAs link straight to the step screen with no misleading ?return param (GAP-04)", () => {
    renderWizard();
    const orgCta = screen.getByRole("link", { name: /Add office details/i });
    expect(orgCta).toHaveAttribute("href", expect.not.stringContaining("return="));
    // departments points at the real management screen
    const deptCta = screen.getByRole("link", { name: /Add departments/i });
    expect(deptCta).toHaveAttribute("href", "/hr/departments");
    // modules has its own anchor, distinct from org-profile
    const modCta = screen.getByRole("link", { name: /Choose modules/i });
    expect(modCta).toHaveAttribute("href", "/tenant-admin/settings#modules");
  });
});

describe("SetupWizard icons (GAP-SETUP-HOME-06)", () => {
  it("renders DS vector icons and no emoji glyphs", () => {
    const { container } = renderWizard({
      steps: stepViews(),
      ready: true,
      doneCount: WIZARD_STEPS.length,
    });
    // No raw emoji anywhere in the rendered markup.
    expect(container.textContent ?? "").not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    // lucide icons render as <svg> elements (one per step + the ready card).
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(WIZARD_STEPS.length);
  });

  it("the readiness encouragement text carries no emoji", () => {
    renderWizard({ ready: true, doneCount: WIZARD_STEPS.length });
    expect(screen.getByText(/your office is ready to go\./i).textContent ?? "").not.toMatch(/🎉/u);
  });
});
