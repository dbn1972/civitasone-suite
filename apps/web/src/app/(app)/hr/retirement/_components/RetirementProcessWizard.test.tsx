import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RetirementProcessWizard } from "./RetirementProcessWizard";

// UX-008 tranche 2: the step panel's Previous/Next buttons were ad hoc
// inline-styled (no shared design-system class) -- converted onto the
// shared Button component. The step *tab bar* above the panel was left
// untouched: it's a 3-state (done/active/neutral) role="tab" control that
// doesn't fit Button's binary variant model, unlike the simple
// enabled/disabled Previous/Next pair. No prior test existed for this file,
// so this covers step navigation.
describe("RetirementProcessWizard", () => {
  it("disables Previous on the first step and it advances via Next", () => {
    render(<RetirementProcessWizard employeeName="K. Ramesh" />);
    expect(screen.getByRole("heading", { name: /Step 1 — NOC from Departments/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Previous" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next Step →" }));
    expect(screen.getByRole("heading", { name: /Step 2 — Final Pay Certificate/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Previous" })).toBeEnabled();
  });

  it("Previous returns to the prior step", () => {
    render(<RetirementProcessWizard employeeName="K. Ramesh" />);
    fireEvent.click(screen.getByRole("button", { name: "Next Step →" }));
    fireEvent.click(screen.getByRole("button", { name: "← Previous" }));
    expect(screen.getByRole("heading", { name: /Step 1 — NOC from Departments/ })).toBeInTheDocument();
  });

  it("shows no Next button on the final step", () => {
    render(<RetirementProcessWizard employeeName="K. Ramesh" />);
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Next Step →" }));
    }
    expect(screen.getByRole("heading", { name: /Step 5 — Pension Order/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next Step →" })).not.toBeInTheDocument();
  });
});
