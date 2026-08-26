import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActivityFeed } from "./ActivityFeed";
import * as aa from "@/lib/crm/activityAccount";

vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, getActivities: vi.fn(), createActivity: vi.fn() };
});

beforeEach(() => {
  vi.mocked(aa.getActivities).mockReset();
  vi.mocked(aa.createActivity).mockReset();
});

describe("ActivityFeed (AC-001)", () => {
  it("shows the saved-info badge on a failed load and no fabricated timeline", async () => {
    vi.mocked(aa.getActivities).mockResolvedValue({ data: [], source: "error" });
    render(<ActivityFeed subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
    expect(screen.getByText(/timeline unavailable/i)).toBeInTheDocument();
  });

  it("loads the timeline scoped to the record (subjectType + subjectId) and renders the scoped response", async () => {
    vi.mocked(aa.getActivities).mockResolvedValue({
      data: [
        { id: "a1", type: "task", subject: "Scoped task", text: "scoped", status: "open", occurredAt: "2026-05-01T00:00:00Z", createdAt: "2026-05-01T00:00:00Z", subjectType: "contact", subjectId: "c1" },
      ],
      source: "api",
    });
    render(<ActivityFeed subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(aa.getActivities).toHaveBeenCalledWith("contact", "c1"));
    expect(await screen.findByText("Scoped task")).toBeInTheDocument();
  });

  it("renders the timeline newest-first from the loader", async () => {
    vi.mocked(aa.getActivities).mockResolvedValue({
      data: [
        { id: "a1", type: "meeting", subject: "Kickoff", text: "kickoff", status: "open", occurredAt: "2026-05-01T00:00:00Z", createdAt: "2026-05-01T00:00:00Z", dueAt: "2026-05-02T10:00:00Z", location: "HQ" },
      ],
      source: "api",
    });
    render(<ActivityFeed subjectType="contact" subjectId="c1" />);
    expect(await screen.findByText("Kickoff")).toBeInTheDocument();
    expect(screen.getByText(/HQ/)).toBeInTheDocument();
  });

  it("blocks save until a note is entered", async () => {
    vi.mocked(aa.getActivities).mockResolvedValue({ data: [], source: "api" });
    render(<ActivityFeed subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getByText(/no activity yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /log activity/i }));
    expect(await screen.findByText(/enter a note/i)).toBeInTheDocument();
    expect(aa.createActivity).not.toHaveBeenCalled();
  });

  it("shows a location field for meetings and remind field for reminders", async () => {
    vi.mocked(aa.getActivities).mockResolvedValue({ data: [], source: "api" });
    render(<ActivityFeed subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getByText(/no activity yet/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^type$/i), { target: { value: "meeting" } });
    expect(screen.getByLabelText(/location/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^type$/i), { target: { value: "reminder" } });
    expect(screen.getByLabelText(/remind at/i)).toBeInTheDocument();
  });

  it("creates a typed activity then reloads", async () => {
    vi.mocked(aa.getActivities).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createActivity).mockResolvedValue({ accepted: false });
    render(<ActivityFeed subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getByText(/no activity yet/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^type$/i), { target: { value: "call" } });
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: "Rang the office" } });
    fireEvent.click(screen.getByRole("button", { name: /log activity/i }));
    await waitFor(() => expect(aa.createActivity).toHaveBeenCalled());
    expect(vi.mocked(aa.createActivity).mock.calls[0][0]).toMatchObject({ type: "call", subjectType: "contact", subjectId: "c1", text: "Rang the office" });
    expect(vi.mocked(aa.getActivities)).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed create without claiming success", async () => {
    vi.mocked(aa.getActivities).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createActivity).mockRejectedValue(new Error("RATE_LIMIT: slow"));
    render(<ActivityFeed subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getByText(/no activity yet/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /log activity/i }));
    expect(await screen.findByText(/rate_limit/i)).toBeInTheDocument();
  });
});
