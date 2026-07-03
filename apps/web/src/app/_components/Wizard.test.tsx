import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Wizard, type WizardStep } from "./Wizard";

describe("Wizard", () => {
  const steps: WizardStep[] = [
    { title: "Step 1", description: "First step", content: <div>Content 1</div> },
    { title: "Step 2", content: <div>Content 2</div> },
    { title: "Step 3", content: <div>Content 3</div> },
  ];

  it("renders the first step content", () => {
    render(<Wizard steps={steps} onComplete={vi.fn()} />);
    expect(screen.getByText("Content 1")).toBeInTheDocument();
    expect(screen.getByText("First step")).toBeInTheDocument();
  });

  it("renders step indicators with numbers", () => {
    render(<Wizard steps={steps} onComplete={vi.fn()} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("moves to next step on Next click", () => {
    render(<Wizard steps={steps} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("Content 2")).toBeInTheDocument();
    expect(screen.queryByText("Content 1")).not.toBeInTheDocument();
  });

  it("moves back on Back click", () => {
    render(<Wizard steps={steps} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("← Back"));
    expect(screen.getByText("Content 1")).toBeInTheDocument();
  });

  it("disables Back button on first step", () => {
    render(<Wizard steps={steps} onComplete={vi.fn()} />);
    expect(screen.getByText("← Back")).toBeDisabled();
  });

  it("shows Submit on last step", () => {
    render(<Wizard steps={steps} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("Submit ✓")).toBeInTheDocument();
  });

  it("calls onComplete on Submit click", () => {
    const onComplete = vi.fn();
    render(<Wizard steps={steps} onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Submit ✓"));
    expect(onComplete).toHaveBeenCalled();
  });

  it("respects validation — does not advance if validate returns false", () => {
    const validatedSteps: WizardStep[] = [
      { title: "S1", content: <div>Step A</div>, validate: () => false },
      { title: "S2", content: <div>Step B</div> },
    ];
    render(<Wizard steps={validatedSteps} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("Step A")).toBeInTheDocument();
    expect(screen.queryByText("Step B")).not.toBeInTheDocument();
  });

  it("advances when validate returns true", () => {
    const validatedSteps: WizardStep[] = [
      { title: "S1", content: <div>Step A</div>, validate: () => true },
      { title: "S2", content: <div>Step B</div> },
    ];
    render(<Wizard steps={validatedSteps} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("Step B")).toBeInTheDocument();
  });

  it("shows checkmark for completed steps", () => {
    render(<Wizard steps={steps} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("✓")).toBeInTheDocument();
  });
});
