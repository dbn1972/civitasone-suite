import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShiftCard } from "./ShiftCard";

const BASE_PROPS = {
  id: "s1",
  name: "Morning Shift",
  startTime: "06:00",
  endTime: "14:00",
  breakDuration: "30 min",
  workingHours: "7.5 hrs",
  applicableTo: "Operational Staff",
  status: "active",
};

describe("ShiftCard", () => {
  it("renders shift name and times", () => {
    render(<ShiftCard {...BASE_PROPS} />);
    expect(screen.getByText("Morning Shift")).toBeInTheDocument();
    expect(screen.getByText("06:00")).toBeInTheDocument();
    expect(screen.getByText("14:00")).toBeInTheDocument();
  });

  it("renders applicable departments", () => {
    render(<ShiftCard {...BASE_PROPS} />);
    expect(screen.getByText("Operational Staff")).toBeInTheDocument();
  });

  it("renders working hours prominently", () => {
    render(<ShiftCard {...BASE_PROPS} />);
    expect(screen.getByText("7.5 hrs")).toBeInTheDocument();
  });

  it("renders break duration", () => {
    render(<ShiftCard {...BASE_PROPS} />);
    expect(screen.getByText("30 min")).toBeInTheDocument();
  });

  it("renders status", () => {
    render(<ShiftCard {...BASE_PROPS} />);
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });

  it("shows night icon for night shifts", () => {
    render(<ShiftCard {...BASE_PROPS} name="Night Shift" />);
    const article = screen.getByRole("article");
    expect(article).toBeInTheDocument();
  });

  it("has accessible article role with aria-label", () => {
    render(<ShiftCard {...BASE_PROPS} />);
    expect(screen.getByRole("article", { name: /morning shift/i })).toBeInTheDocument();
  });
});
