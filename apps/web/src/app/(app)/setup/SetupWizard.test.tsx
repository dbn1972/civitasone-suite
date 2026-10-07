import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Instrumentation is a fire-and-forget beacon — stub it so tests don't touch it.
vi.mock("@/lib/activation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/activation")>("@/lib/activation");
  return { ...actual, trackActivation: vi.fn() };
});

// SkipStepButton (client) uses next/navigation's useRouter and the skip API.
const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
const persistSkippedStep = vi.fn(async (_stepKey: string) => true);
const unskipStep = vi.fn(async (_stepKey: string) => true);
vi.mock("./setupSkipApi", () => ({
  persistSkippedStep: (stepKey: string) => persistSkippedStep(stepKey),
  unskipStep: (stepKey: string) => unskipStep(stepKey),
}));

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
  it("optional, not-complete steps offer a 'Skip for now' control that persists a deferral (GAP-02)", async () => {
    renderWizard();
    // Honest copy: no "Do it later", and the old plain 'Skip to dashboard' link
    // (which saved nothing) is gone.
    expect(screen.queryByText(/Do it later/i)).toBeNull();
    expect(screen.queryByText(/Skip to dashboard/i)).toBeNull();

    const skip = screen.getAllByRole("button", { name: /Skip ".*" for now/i })[0]!;
    expect(skip).toBeInTheDocument();
    fireEvent.click(skip);
    // Persists BEFORE navigating, then routes to the dashboard.
    await waitFor(() => expect(persistSkippedStep).toHaveBeenCalled());
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("a skipped step reads 'Skipped', stays openable, and offers Un-skip (GAP-02)", () => {
    // Mark the first OPTIONAL step as skipped.
    const steps = WIZARD_STEPS.map((s) => ({
      ...s,
      status: (!s.required ? "skipped" : "todo") as StepStatus,
    }));
    renderWizard({ steps });
    expect(screen.getAllByText("Skipped").length).toBeGreaterThan(0);
    // Still openable.
    expect(screen.getAllByRole("link", { name: /Open anyway/i }).length).toBeGreaterThan(0);
    // The deferral is reversible.
    expect(screen.getAllByRole("button", { name: /back into the setup steps/i }).length).toBeGreaterThan(0);
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
