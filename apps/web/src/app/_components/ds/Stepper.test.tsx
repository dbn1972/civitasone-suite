import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Stepper } from "./Stepper";

describe("Stepper — GAP-ESTAB-WORKSPACE-06", () => {
  const steps = ["Receipt", "Open file", "Note & submit", "Draft outgoing", "Done"] as const;

  it("renders a labelled ordered list with one item per step", () => {
    render(<Stepper steps={steps} current={2} ariaLabel="Progress" />);
    const list = screen.getByRole("list", { name: /progress/i });
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
  });

  it("marks exactly one item with aria-current='step'", () => {
    render(<Stepper steps={steps} current={2} />);
    const items = screen.getAllByRole("listitem");
    const current = items.filter((li) => li.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Note & submit");
  });

  it("exposes a visually-hidden completed marker for finished steps", () => {
    render(<Stepper steps={steps} current={2} />);
    expect(screen.getAllByText("(completed)")).toHaveLength(2); // steps 0 and 1
  });

  it("uses design tokens, not hard-coded hex, for state colours", () => {
    const { container } = render(<Stepper steps={steps} current={2} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/#4f46e5/i);
    expect(html).not.toMatch(/#e2e8f0/i);
    expect(html).not.toMatch(/#cbd5e1/i);
    expect(html).toMatch(/var\(--accent\)/);
    expect(html).toMatch(/var\(--good\)/);
  });
});
