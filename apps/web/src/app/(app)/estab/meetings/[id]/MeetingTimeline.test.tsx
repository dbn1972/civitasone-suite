import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MeetingTimeline, meetingStages, type MeetingTimelineLabels } from "./MeetingTimeline";

const labels: MeetingTimelineLabels = {
  scheduled: "Scheduled", agendaCirculated: "Agenda circulated", held: "Meeting held", momIssued: "MOM issued", actionsClosed: "Actions closed",
};
const li = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("MeetingTimeline (GAP-ESTAB-MEETINGS-DETAIL-02)", () => {
  it("renders no empty date slot: only Scheduled has a date", () => {
    const { container } = render(
      <MeetingTimeline status="completed" scheduledDate="01 Oct 2026" hasMinutes actionPointStatuses={["completed"]} labels={labels} />,
    );
    const dates = container.querySelectorAll(".d");
    expect(dates).toHaveLength(1);
    expect(dates[0]!.textContent).toBe("01 Oct 2026");
    expect(Array.from(dates).every((d) => d.textContent !== "")).toBe(true);
  });

  it("renders no date slot at all when the scheduled date is unknown", () => {
    const { container } = render(
      <MeetingTimeline status="scheduled" scheduledDate="" hasMinutes={false} actionPointStatuses={[]} labels={labels} />,
    );
    expect(container.querySelectorAll(".d")).toHaveLength(0);
  });

  it("Given a cancelled meeting, Then Agenda circulated is not shown as done", () => {
    render(<MeetingTimeline status="cancelled" scheduledDate="01 Oct 2026" hasMinutes={false} actionPointStatuses={[]} labels={labels} />);
    expect(li("Agenda circulated").className).toBe("todo");
    expect(li("Meeting held").className).toBe("todo");
  });

  it("Given a scheduled meeting with no action points, Then Actions closed is todo (empty .every() is vacuously true)", () => {
    render(<MeetingTimeline status="scheduled" scheduledDate="01 Oct 2026" hasMinutes={false} actionPointStatuses={[]} labels={labels} />);
    expect(li("Actions closed").className).toBe("todo");
  });

  it("Given a completed meeting with minutes and every action completed, Then every stage is done", () => {
    render(<MeetingTimeline status="completed" scheduledDate="01 Oct 2026" hasMinutes actionPointStatuses={["completed", "completed"]} labels={labels} />);
    for (const name of Object.values(labels)) expect(li(name).className).toBe("done");
  });

  it("an in-progress meeting is the current stage; a completed one with an open action keeps Actions closed todo", () => {
    expect(meetingStages({ status: "in_progress", hasMinutes: false, actionPointStatuses: [] })).toEqual({ agenda: "done", held: "cur", mom: "todo", actions: "todo" });
    expect(meetingStages({ status: "completed", hasMinutes: true, actionPointStatuses: ["completed", "pending"] }).actions).toBe("todo");
  });
});
