import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { OverdueTaskAlerts, subjectHref } from "./OverdueTaskAlerts";
import * as aa from "@/lib/crm/activityAccount";

import type { ReactElement } from "react";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}


vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, getOverdueTaskPage: vi.fn(), snoozeTask: vi.fn(), reassignTask: vi.fn(), getEscalationUsers: vi.fn() };
});

/** A page of overdue tasks as the loader returns it: the rows plus the REAL total. */
function page(tasks: aa.OverdueTask[], total: number = tasks.length) {
  return { data: { tasks, total }, source: "api" as const };
}

beforeEach(() => {
  vi.mocked(aa.getOverdueTaskPage).mockReset();
  vi.mocked(aa.snoozeTask).mockReset();
  vi.mocked(aa.reassignTask).mockReset();
  vi.mocked(aa.getEscalationUsers).mockReset().mockResolvedValue({ data: [], source: "api" });
});

describe("OverdueTaskAlerts (AC-005)", () => {
  it("gates the count on error → shows dash + saved-info badge, never a 0", async () => {
    vi.mocked(aa.getOverdueTaskPage).mockResolvedValue({ data: { tasks: [], total: 0 }, source: "error" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OverdueTaskAlerts /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
    expect(screen.getByText(/overdue tasks unavailable/i)).toBeInTheDocument();
  });

  it("shows an empty state when nothing is overdue", async () => {
    vi.mocked(aa.getOverdueTaskPage).mockResolvedValue(page([]));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OverdueTaskAlerts /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/nothing overdue/i)).toBeInTheDocument());
  });

  it("lists overdue tasks with a plain-words ageing", async () => {
    vi.mocked(aa.getOverdueTaskPage).mockResolvedValue(
      page([{ id: "t1", subject: "Send quote", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 1500, owner: "Priya Nair", subjectType: "contact", subjectId: "c1" }]),
    );
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
    vi.mocked(aa.getOverdueTaskPage).mockResolvedValue(
      page([{ id: "t1", subject: "Call back", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 100, ownerId: UUID }]),
    );
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OverdueTaskAlerts /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Call back")).toBeInTheDocument());
    expect(screen.queryByText(UUID)).not.toBeInTheDocument();
    expect(screen.getByText("Assigned (name unavailable)")).toBeInTheDocument();
  });

  // GAP-CRM-TASK-ESCALATION-02 — the server pages (50 per page) and reports the real total, so a
  // backlog bigger than one page is fully reachable. The old test fed 120 rows straight to the
  // component, which the real loader (limit=50, no offset) could never do.
  const rows = (from: number, n: number): aa.OverdueTask[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `t${from + i}`,
      subject: `Task ${from + i}`,
      dueAt: "2026-08-03T12:00:00Z",
      ageMinutes: 1000 - (from + i),
      owner: `Owner ${from + i}`,
    }));

  it("pages a large overdue backlog through the server: 50 a page, the real total, a working Next", async () => {
    const { fireEvent } = await import("@testing-library/react");
    vi.mocked(aa.getOverdueTaskPage).mockImplementation(async (opts) =>
      page(rows(opts?.offset ?? 0, Math.min(50, 120 - (opts?.offset ?? 0))), 120),
    );
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OverdueTaskAlerts /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Task 0")).toBeInTheDocument());
    // The first request is for the first 50...
    expect(aa.getOverdueTaskPage).toHaveBeenLastCalledWith({ limit: 50, offset: 0 });
    // ...the headline is the REAL total, not the length of the page...
    expect(screen.getByText("Overdue tasks").nextElementSibling).toHaveTextContent("120");
    expect(screen.getByText("Showing 1–50 of 120")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Task 49")).toBeInTheDocument();
    expect(screen.queryByText("Task 50")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    // ...and Next fetches the NEXT 50 from the server (rows past the 50th used to be unreachable).
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Task 50")).toBeInTheDocument());
    expect(aa.getOverdueTaskPage).toHaveBeenLastCalledWith({ limit: 50, offset: 50 });
    expect(screen.queryByText("Task 0")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 51–100 of 120")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Task 119")).toBeInTheDocument());
    expect(screen.getByText("Showing 101–120 of 120")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getByText("Task 50")).toBeInTheDocument());
  });

  it("shows no pager controls when everything fits on one page, but still says how many", async () => {
    vi.mocked(aa.getOverdueTaskPage).mockResolvedValue(page(rows(0, 3)));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><OverdueTaskAlerts /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Task 0")).toBeInTheDocument());
    expect(screen.getByText("Showing 1–3 of 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("steps back to the last page when the last task on it is cleared, instead of an empty page of a non-empty list", async () => {
    const { fireEvent } = await import("@testing-library/react");
    vi.mocked(aa.getOverdueTaskPage).mockImplementation(async (opts) => {
      const offset = opts?.offset ?? 0;
      // 51 tasks at first; after a snooze the 51st is gone, so page 2 is empty and the total is 50.
      return snoozed
        ? page(offset === 0 ? rows(0, 50) : [], 50)
        : page(offset === 0 ? rows(0, 50) : rows(50, 1), 51);
    });
    let snoozed = false;
    vi.mocked(aa.snoozeTask).mockImplementation(async () => { snoozed = true; return { accepted: true }; });
    renderWithIntl(<OverdueTaskAlerts />);
    await screen.findByText("Task 0");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Task 50");
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/new due date/i), { target: { value: "2099-12-31" } });
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Citizen asked to call after Diwali" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Snooze$/ }));
    // Back on page 1 of 1, with rows - not "Nothing overdue".
    await waitFor(() => expect(screen.getByText("Task 0")).toBeInTheDocument());
    expect(screen.queryByText(/nothing overdue/i)).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1–50 of 50")).toBeInTheDocument();
  });

  // GAP-CRM-TASK-ESCALATION-02 — the owner NAME now comes from crm-service for every viewer, so
  // a crm_user (who cannot list identity users) still sees a name, not "name unavailable".
  it("shows the server-resolved owner name even when the user directory is empty", async () => {
    vi.mocked(aa.getEscalationUsers).mockResolvedValue({ data: [], source: "error" });
    vi.mocked(aa.getOverdueTaskPage).mockResolvedValue(
      page([{ id: "t1", subject: "Send quote", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 100, owner: "Kavita Rao", ownerId: "u-9" }]),
    );
    renderWithIntl(<OverdueTaskAlerts />);
    expect(await screen.findByText("Kavita Rao")).toBeInTheDocument();
    expect(screen.queryByText("Assigned (name unavailable)")).not.toBeInTheDocument();
  });

  it("explains why Reassign is unavailable when the user directory could not be loaded", async () => {
    vi.mocked(aa.getEscalationUsers).mockResolvedValue({ data: [], source: "error" });
    vi.mocked(aa.getOverdueTaskPage).mockResolvedValue(
      page([{ id: "t1", subject: "Send quote", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 100, owner: "Kavita Rao", ownerId: "u-9" }]),
    );
    renderWithIntl(<OverdueTaskAlerts />);
    const btn = await screen.findByRole("button", { name: "Reassign" });
    await waitFor(() => expect(btn).toHaveAttribute("title", expect.stringMatching(/user list is unavailable/i)));
    expect(btn).toBeDisabled();
  });

  // GAP-CRM-TASK-ESCALATION-04 — a task on a deal must link to the deal, not a
  // contact; a lead (no detail route) must render as plain text, not a bad link.
  it("subjectHref routes each subject type to its own detail page", () => {
    expect(subjectHref("account", "a1")).toBe("/crm/accounts/a1");
    expect(subjectHref("contact", "c1")).toBe("/crm/contacts/c1");
    expect(subjectHref("deal", "d1")).toBe("/crm/deals/d1");
    // No /crm/leads/[id] route exists — must not fabricate a wrong link.
    expect(subjectHref("lead", "l1")).toBeNull();
    expect(subjectHref("unknown", "x1")).toBeNull();
    expect(subjectHref("account", "")).toBeNull();
  });

  it("links a deal task to the deal page, and renders a lead task as plain text (GAP-CRM-TASK-ESCALATION-04)", async () => {
    vi.mocked(aa.getOverdueTaskPage).mockResolvedValue(
      page([
        { id: "t1", subject: "Close deal", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 100, subjectType: "deal", subjectId: "d1" },
        { id: "t2", subject: "Qualify lead", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 90, subjectType: "lead", subjectId: "l1" },
      ]),
    );
    renderWithIntl(<OverdueTaskAlerts />);
    const dealLink = await screen.findByRole("link", { name: "Close deal" });
    expect(dealLink).toHaveAttribute("href", "/crm/deals/d1");
    // The lead task has no link.
    expect(screen.queryByRole("link", { name: "Qualify lead" })).not.toBeInTheDocument();
    expect(screen.getByText("Qualify lead")).toBeInTheDocument();
  });

  // GAP-CRM-TASK-ESCALATION-06 — a row Snooze action pushes the task's due date
  // out via PATCH and refreshes the list afterwards.
  it("snoozes a task to a new due date and refreshes the list", async () => {
    const { fireEvent } = await import("@testing-library/react");
    vi.mocked(aa.getOverdueTaskPage)
      .mockResolvedValueOnce(page([{ id: "t1", subject: "Send quote", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 100, owner: "Priya" }]))
      .mockResolvedValue(page([]));
    vi.mocked(aa.snoozeTask).mockResolvedValue({ accepted: true });

    renderWithIntl(<OverdueTaskAlerts />);
    fireEvent.click(await screen.findByRole("button", { name: "Snooze" }));

    // Modal opens with a date input; submit the snooze.
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/new due date/i), { target: { value: "2099-12-31" } });
    // A reason is required (recorded in the audit trail): Snooze stays disabled without one.
    expect(within(dialog).getByRole("button", { name: /^Snooze$/ })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Citizen asked to call after Diwali" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Snooze$/ }));

    await waitFor(() => expect(aa.snoozeTask).toHaveBeenCalledWith("t1", "2099-12-31", "Citizen asked to call after Diwali"));
    // The list re-fetches; the snoozed task drops off (now empty).
    await waitFor(() => expect(screen.getByText(/nothing overdue/i)).toBeInTheDocument());
  });

  // GAP-CRM-TASK-ESCALATION-06 acceptance: Reassign updates the owner. The owner
  // name comes from the identity directory, never the raw id.
  it("shows the owner's name and reassigns a task with a reason", async () => {
    const { fireEvent } = await import("@testing-library/react");
    vi.mocked(aa.getEscalationUsers).mockResolvedValue({
      data: [{ id: "u-1", name: "Priya Nayak" }, { id: "u-2", name: "Ravi Das" }],
      source: "api",
    });
    vi.mocked(aa.getOverdueTaskPage)
      .mockResolvedValueOnce(page([{ id: "t1", subject: "Send quote", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 100, ownerId: "u-1" }]))
      .mockResolvedValue(page([{ id: "t1", subject: "Send quote", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 100, ownerId: "u-2" }]));
    vi.mocked(aa.reassignTask).mockResolvedValue({ accepted: true });

    renderWithIntl(<OverdueTaskAlerts />);
    expect(await screen.findByText("Priya Nayak")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    const dialog = await screen.findByRole("dialog");
    // The current owner is not offered as a target.
    const select = within(dialog).getByLabelText(/new owner/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).not.toContain("Priya Nayak");
    fireEvent.change(select, { target: { value: "u-2" } });
    expect(within(dialog).getByRole("button", { name: /^Reassign$/ })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Priya is on leave this week" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Reassign$/ }));

    await waitFor(() => expect(aa.reassignTask).toHaveBeenCalledWith("t1", "u-2", "Priya is on leave this week"));
    expect(await screen.findByText("Ravi Das")).toBeInTheDocument();
  });
});
