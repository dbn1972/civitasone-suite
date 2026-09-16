import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GoalTrackerCard } from "./GoalTrackerCard";

const PROPS = {
  id: "g1",
  title: "Digitize 10,000 land records",
  progress: 40,
  status: "on_track" as const,
  category: "Digital India",
};

// UX-008 tranche 2: Edit/Check-in/Cancel/Save were ad hoc inline-styled
// buttons (no shared design-system class at all) -- converted onto the
// shared Button component. No prior test existed for this file, so these
// cover that the click/toggle/callback wiring still works post-conversion.
describe("GoalTrackerCard", () => {
  it("calls onEdit with the goal id when Edit is clicked", () => {
    const onEdit = vi.fn();
    render(<GoalTrackerCard {...PROPS} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith("g1");
  });

  it("does not render an Edit button when onEdit is not supplied", () => {
    render(<GoalTrackerCard {...PROPS} />);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("opens the check-in form, then Cancel closes it without calling onCheckin", () => {
    const onCheckin = vi.fn();
    render(<GoalTrackerCard {...PROPS} onCheckin={onCheckin} />);
    fireEvent.click(screen.getByRole("button", { name: "Check-in" }));
    expect(screen.getByText("New progress (%)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("New progress (%)")).not.toBeInTheDocument();
    expect(onCheckin).not.toHaveBeenCalled();
  });

  it("Save submits the edited progress and note, then closes the form", () => {
    const onCheckin = vi.fn();
    render(<GoalTrackerCard {...PROPS} onCheckin={onCheckin} />);
    fireEvent.click(screen.getByRole("button", { name: "Check-in" }));

    fireEvent.change(screen.getByLabelText(/New progress/), { target: { value: "65" } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "Surveyed 3 more districts" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onCheckin).toHaveBeenCalledWith("g1", 65, "Surveyed 3 more districts");
    expect(screen.queryByText("New progress (%)")).not.toBeInTheDocument();
  });
});
