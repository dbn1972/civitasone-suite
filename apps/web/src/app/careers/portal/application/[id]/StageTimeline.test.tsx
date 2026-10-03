import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StageTimeline, type StageTimelineLabels } from "./StageTimeline";
import type { StageEntry } from "./fetchApplication";

const labels: StageTimelineLabels = {
  completed: "completed", current: "current step", upcoming: "upcoming", ended: "ended", inProgress: "In progress",
  venue: "Venue", joinLink: "Join the interview", minutes: (n) => `${n} minutes`, mode: (m) => (m === "in_person" ? "In-person interview" : m),
};

const timeline: StageEntry[] = [
  { stage: "applied", label: "Application Submitted", status: "done", note: "2026-03-01T10:00:00.000Z" },
  { stage: "screening", label: "Under Review", status: "active", note: "" },
  { stage: "shortlisted", label: "Shortlisted", status: "future", note: "" },
];

describe("StageTimeline (GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-07)", () => {
  it("is an ordered list with one item per stage", () => {
    render(<StageTimeline timeline={timeline} labels={labels} />);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem").filter((li) => li.getAttribute("role") !== "presentation")).toHaveLength(3);
  });

  it("marks the active step aria-current and announces completed / current / upcoming as text", () => {
    const { container } = render(<StageTimeline timeline={timeline} labels={labels} />);
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain("Under Review");
    expect(current[0]!.textContent).toContain("(current step)");
    expect(container.textContent).toContain("Application Submitted (completed)");
    expect(container.textContent).toContain("Shortlisted (upcoming)");
  });

  it("hides the decorative check glyph from assistive tech", () => {
    const { container } = render(<StageTimeline timeline={timeline} labels={labels} />);
    const check = [...container.querySelectorAll("span")].find((s) => s.textContent === "✓")!;
    expect(check.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("renders dates in IST and never 'Invalid Date' for a missing or bad timestamp", () => {
    const bad: StageEntry[] = [{ stage: "applied", label: "A", status: "done", note: "not-a-date" }, { stage: "x", label: "B", status: "future", note: "" }];
    const { container, rerender } = render(<StageTimeline timeline={bad} labels={labels} />);
    expect(container.textContent).not.toMatch(/Invalid|NaN/);
    rerender(<StageTimeline timeline={timeline} labels={labels} />);
    expect(container.textContent).toContain("1 Mar 2026");
  });

  it("shows the interview date, time, mode, venue and a link only for https", () => {
    const iv: StageEntry[] = [{
      stage: "interview", label: "Interview Scheduled", status: "active", note: "2026-10-05T09:30:00.000Z",
      interview: { at: "2026-10-05T09:30:00.000Z", mode: "in_person", durationMinutes: 45, venue: "Room 4, Secretariat", meetingLink: "https://meet.example.gov.in/x" },
    }];
    render(<StageTimeline timeline={iv} labels={labels} />);
    const d = screen.getByTestId("interview-detail");
    expect(d.textContent).toContain("In-person interview · 45 minutes");
    expect(d.textContent).toContain("Venue: Room 4, Secretariat");
    expect(screen.getByRole("link", { name: "Join the interview" })).toHaveAttribute("href", "https://meet.example.gov.in/x");
    // 09:30 UTC is 3:00 pm IST
    expect(document.body.textContent).toMatch(/5 Oct 2026, 03:00 pm/i);
  });
});
