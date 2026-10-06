import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import hiMessages from "@/messages/hi.json";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { UserFacingError } from "@/lib/userFacingError";
import { OverdueTaskAlerts } from "./OverdueTaskAlerts";
import * as aa from "@/lib/crm/activityAccount";

vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, getOverdueTasks: vi.fn(), snoozeTask: vi.fn(), reassignTask: vi.fn(), getEscalationUsers: vi.fn() };
});

const TASK = { id: "t1", subject: "Send quote", dueAt: "2026-08-03T12:00:00Z", ageMinutes: 100, ownerId: "u-1" };
const USERS = [{ id: "u-1", name: "Priya Nayak" }, { id: "u-2", name: "Ravi Das" }];

beforeEach(() => {
  vi.mocked(aa.getOverdueTasks).mockReset().mockResolvedValue({ data: [TASK], source: "api" });
  vi.mocked(aa.snoozeTask).mockReset();
  vi.mocked(aa.reassignTask).mockReset();
  vi.mocked(aa.getEscalationUsers).mockReset().mockResolvedValue({ data: USERS, source: "api" });
});

describe("OverdueTaskAlerts is translated (GAP-CRM-TASK-ESCALATION)", () => {
  it("renders Hindi copy for the stat, table, and actions when the locale is hi", async () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <OverdueTaskAlerts />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText("विलंबित खुले कार्य")).toBeInTheDocument();
    expect(screen.getByText("विलंबित कार्य")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "पुनः सौंपें" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "स्थगित करें" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Snooze" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "स्थगित करें" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("नई नियत तिथि")).toBeInTheDocument();
    expect(within(dialog).getByText(/कारण/)).toBeInTheDocument();
  });
});

describe("OverdueTaskAlerts uses the shared human error (no raw exception text)", () => {
  async function openReassign() {
    renderWithIntl(<OverdueTaskAlerts />);
    await screen.findByText("Priya Nayak");
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/new owner/i), { target: { value: "u-2" } });
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Priya is on leave this week" } });
    return dialog;
  }

  it("does not surface a network TypeError (Failed to fetch) when reassign fails", async () => {
    vi.mocked(aa.reassignTask).mockRejectedValue(new TypeError("Failed to fetch"));
    const dialog = await openReassign();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Reassign$/ }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/failed to fetch/i);
    expect((alert.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("keeps an already-humanised UserFacingError message verbatim on reassign", async () => {
    vi.mocked(aa.reassignTask).mockRejectedValue(new UserFacingError("You can only reassign your own tasks. Ask a manager."));
    const dialog = await openReassign();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Reassign$/ }));
    expect(await within(dialog).findByText("You can only reassign your own tasks. Ask a manager.")).toBeInTheDocument();
  });

  it("does not surface a raw Error message when snooze fails", async () => {
    vi.mocked(aa.snoozeTask).mockRejectedValue(new Error("ECONNRESET at socket.js:42"));
    renderWithIntl(<OverdueTaskAlerts />);
    await screen.findByText("Priya Nayak");
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Citizen asked to call after the holiday" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Snooze$/ }));
    const alert = await within(dialog).findByRole("alert");
    await waitFor(() => expect(alert.textContent ?? "").not.toMatch(/ECONNRESET/));
    expect((alert.textContent ?? "").trim().length).toBeGreaterThan(0);
  });
});
