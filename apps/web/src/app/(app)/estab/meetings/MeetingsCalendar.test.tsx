import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MeetingsCalendar } from "./MeetingsCalendar";

describe("MeetingsCalendar (fix 3 — the Calendar toggle now does something real)", () => {
  it("renders a month grid with the meeting placed on its scheduled day", () => {
    render(
      <MeetingsCalendar
        meetings={[
          { id: "m1", title: "Budget Review", scheduledDate: "2027-03-15", scheduledTime: "10:00" },
        ]}
      />,
    );
    expect(screen.getByText("March 2027")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Budget Review/ });
    expect(link).toHaveAttribute("href", "/estab/meetings/m1");
  });

  it("navigates months with Prev/Next", () => {
    render(
      <MeetingsCalendar
        meetings={[{ id: "m1", title: "Budget Review", scheduledDate: "2027-03-15" }]}
      />,
    );
    expect(screen.getByText("March 2027")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getByText("April 2027")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← Prev" }));
    expect(screen.getByText("March 2027")).toBeInTheDocument();
  });

  it("renders an empty grid without crashing when there are no meetings", () => {
    render(<MeetingsCalendar meetings={[]} />);
    // Falls back to the current month; just assert the weekday header renders.
    expect(screen.getByText("Sun")).toBeInTheDocument();
  });
});
