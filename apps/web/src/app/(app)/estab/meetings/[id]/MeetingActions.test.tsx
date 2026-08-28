import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MeetingActions } from "./MeetingActions";

describe("MeetingActions (fix 3)", () => {
  it("disables Generate MOM instead of linking to the nonexistent /generate-mom route", () => {
    render(<MeetingActions meetingId="m1" />);
    const btn = screen.getByRole("button", { name: /Generate MOM/ });
    expect(btn).toBeDisabled();
  });

  it("keeps Agenda as a working link with the tab query param", () => {
    render(<MeetingActions meetingId="m1" />);
    const link = screen.getByRole("link", { name: "Agenda" });
    expect(link).toHaveAttribute("href", "/estab/meetings/m1?tab=agenda");
  });
});
