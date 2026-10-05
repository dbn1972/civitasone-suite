import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
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
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OverdueTaskAlerts /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
    expect(screen.getByText(/overdue tasks unavailable/i)).toBeInTheDocument();
  });

  it("shows an empty state when nothing is overdue", async () => {
    vi.mocked(aa.getOverdueTasks).mockResolvedValue({ data: [], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OverdueTaskAlerts /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/nothing overdue/i)).toBeInTheDocument());
  });

  it("lists overdue tasks with a plain-words ageing", async () => {
    vi.mocked(aa.getOverdueTasks).mockResolvedValue({
      data: [{ id: "t1", subject: "Send quote", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 1500, owner: "Priya Nair", subjectType: "contact", subjectId: "c1" }],
      source: "api",
    });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OverdueTaskAlerts /></NextIntlClientProvider>);
    expect(await screen.findByRole("link", { name: "Send quote" })).toBeInTheDocument();
    expect(screen.getByText("1d 1h")).toBeInTheDocument();
    // Count stat value is specifically the StatCard's value, not any stray "1".
    expect(screen.getByText("Overdue tasks").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
  });

  // GAP-CRM-TASK-ESCALATION-02 (IDLEAK) — a task known only by an opaque owner
  // id must NOT render that UUID in the Owner cell. Before the fix the loader
  // fell back owner → actorName → ownerId, printing the id verbatim.
  it("never renders a raw owner id in the Owner cell", async () => {
    const UUID = "9f1c0b2a-1111-2222-3333-444455556666";
    vi.mocked(aa.getOverdueTasks).mockResolvedValue({
      data: [{ id: "t1", subject: "Call back", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 100, ownerId: UUID }],
      source: "api",
    });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OverdueTaskAlerts /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Call back")).toBeInTheDocument());
    expect(screen.queryByText(UUID)).not.toBeInTheDocument();
    expect(screen.getByText("Assigned (name unavailable)")).toBeInTheDocument();
  });

  // GAP-CRM-TASK-ESCALATION-02 — the overdue list must not render an unbounded
  // table: with more than a page of tasks it paginates (50 per page).
  it("paginates a large overdue backlog at 50 per page", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      id: `t${i}`,
      subject: `Task ${i}`,
      dueAt: "2026-08-03T12:00:00Z",
      ageMinutes: 1000 - i,
      owner: `Owner ${i}`,
    }));
    vi.mocked(aa.getOverdueTasks).mockResolvedValue({ data: many, source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OverdueTaskAlerts /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Task 0")).toBeInTheDocument());
    // Page 1 shows the first 50 (0–49), not row 50.
    expect(screen.getByText("Task 49")).toBeInTheDocument();
    expect(screen.queryByText("Task 50")).not.toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
  });
});
