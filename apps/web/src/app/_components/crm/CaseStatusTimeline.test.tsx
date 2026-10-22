import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils/intl-render";
import { CaseStatusTimeline, type CaseHistoryEntry } from "./CaseStatusTimeline";

describe("F6-01 CaseStatusTimeline", () => {
  const entries: CaseHistoryEntry[] = [
    { id: "1", fromStatus: null, toStatus: "open", note: null, actorId: "a", at: "2026-09-01T10:00:00.000Z" },
    { id: "2", fromStatus: "open", toStatus: "in_progress", note: null, actorId: "a", at: "2026-09-02T10:00:00.000Z" },
    { id: "3", fromStatus: "in_progress", toStatus: "resolved", note: "Issued certificate", actorId: "a", at: "2026-09-03T10:00:00.000Z" },
  ];

  it("renders each transition and the note, newest first", () => {
    render(<CaseStatusTimeline entries={entries} />);
    expect(screen.getByText("Status timeline")).toBeInTheDocument();
    expect(screen.getByText("Issued certificate")).toBeInTheDocument();
    // 'Opened' marker for the null-from initial transition.
    expect(screen.getByText("Opened")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(3);
  });

  // GAP-CRM-SERVICE-REQUESTS-DETAIL-03: every entry says WHO made the change, by NAME. The
  // entry carries an actorId, but the id is never what is shown.
  it("shows who made each change by name, never the actor id", () => {
    const UUID = "9f1c0b2a-1111-2222-3333-444455556666";
    render(
      <CaseStatusTimeline
        entries={[
          { id: "1", fromStatus: null, toStatus: "open", note: null, actorId: UUID, actorName: "Meera Nair", at: "2026-09-01T10:00:00.000Z" },
          { id: "2", fromStatus: "open", toStatus: "resolved", note: "Issued", actorId: UUID, actorName: "Rahul Verma", at: "2026-09-02T10:00:00.000Z" },
        ]}
      />,
    );
    expect(screen.getByText("by Meera Nair")).toBeInTheDocument();
    expect(screen.getByText("by Rahul Verma")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(UUID))).not.toBeInTheDocument();
  });

  it("says the name is unavailable (and still not the id) when the actor could not be resolved", () => {
    const UUID = "9f1c0b2a-1111-2222-3333-444455556666";
    render(
      <CaseStatusTimeline
        entries={[
          { id: "1", fromStatus: null, toStatus: "open", note: null, actorId: UUID, actorName: null, at: "2026-09-01T10:00:00.000Z" },
          { id: "2", fromStatus: "open", toStatus: "closed", note: null, actorId: UUID, at: "2026-09-02T10:00:00.000Z" },
        ]}
      />,
    );
    expect(screen.getAllByText("by a user (name unavailable)")).toHaveLength(2);
    expect(screen.queryByText(new RegExp(UUID))).not.toBeInTheDocument();
  });

  it("renders an empty state when there is no history", () => {
    render(<CaseStatusTimeline entries={[]} />);
    expect(screen.getByText(/No status changes recorded yet/i)).toBeInTheDocument();
  });

  it("tolerates a non-array (defensive) without throwing", () => {
    render(<CaseStatusTimeline entries={undefined as unknown as CaseHistoryEntry[]} />);
    expect(screen.getByText(/No status changes recorded yet/i)).toBeInTheDocument();
  });

  it("orders oldest-first input into newest-first output", () => {
    render(<CaseStatusTimeline entries={entries} title="Status timeline" />);
    const items = screen.getAllByRole("listitem");
    // First listed item is the most recent transition (resolved); StatusPill
    // title-cases the label.
    expect(items[0]!.textContent?.toLowerCase()).toContain("resolved");
  });
});
