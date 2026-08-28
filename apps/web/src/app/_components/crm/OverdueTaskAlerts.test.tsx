import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { OverdueTaskAlerts } from "./OverdueTaskAlerts";
import * as aa from "@/lib/crm/activityAccount";

vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, getOverdueTasks: vi.fn() };
});

beforeEach(() => vi.mocked(aa.getOverdueTasks).mockReset());

describe("OverdueTaskAlerts (AC-005)", () => {
  it("gates the count on error → shows dash + saved-info badge, never a 0", async () => {
    vi.mocked(aa.getOverdueTasks).mockResolvedValue({ data: [], source: "error" });
    render(<OverdueTaskAlerts />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
    expect(screen.getByText(/overdue tasks unavailable/i)).toBeInTheDocument();
  });

  it("shows an empty state when nothing is overdue", async () => {
    vi.mocked(aa.getOverdueTasks).mockResolvedValue({ data: [], source: "api" });
    render(<OverdueTaskAlerts />);
    await waitFor(() => expect(screen.getByText(/nothing overdue/i)).toBeInTheDocument());
  });

  it("lists overdue tasks with a plain-words ageing", async () => {
    vi.mocked(aa.getOverdueTasks).mockResolvedValue({
      data: [{ id: "t1", subject: "Send quote", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 1500, owner: "u9", subjectType: "contact", subjectId: "c1" }],
      source: "api",
    });
    render(<OverdueTaskAlerts />);
    expect(await screen.findByRole("link", { name: "Send quote" })).toBeInTheDocument();
    expect(screen.getByText("1d 1h")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // count stat
  });
});
