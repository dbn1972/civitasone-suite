import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TaskEscalationEditor } from "./TaskEscalationEditor";
import * as aa from "@/lib/crm/activityAccount";

vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return {
    ...actual,
    getTaskEscalationRules: vi.fn(),
    createTaskEscalationRule: vi.fn(),
    updateTaskEscalationRule: vi.fn(),
    deleteTaskEscalationRule: vi.fn(),
    getEscalationRoles: vi.fn(),
    getEscalationUsers: vi.fn(),
    getOverdueTasks: vi.fn(),
  };
});

const rule: aa.TaskEscalationRule = { id: "e1", thresholdMinutes: 1440, managerRole: "sales_manager", managerId: "", enabled: true };

const ROLES: aa.EscalationRole[] = [
  { key: "sales_manager", label: "Sales Manager" },
  { key: "ops_manager", label: "Operations Manager" },
];
const USERS: aa.EscalationUser[] = [
  { id: "u-100", name: "Priya Nair" },
  { id: "u-200", name: "Arjun Rao" },
];

beforeEach(() => {
  vi.mocked(aa.getTaskEscalationRules).mockReset();
  vi.mocked(aa.createTaskEscalationRule).mockReset();
  vi.mocked(aa.updateTaskEscalationRule).mockReset();
  vi.mocked(aa.deleteTaskEscalationRule).mockReset();
  vi.mocked(aa.getEscalationRoles).mockReset().mockResolvedValue({ data: ROLES, source: "api" });
  vi.mocked(aa.getEscalationUsers).mockReset().mockResolvedValue({ data: USERS, source: "api" });
  vi.mocked(aa.getOverdueTasks).mockReset().mockResolvedValue({
    data: [
      { id: "t1", subject: "a", dueAt: "2026-08-01T00:00:00Z", ageMinutes: 100 },
      { id: "t2", subject: "b", dueAt: "2026-08-01T00:00:00Z", ageMinutes: 200 },
    ],
    source: "api",
  });
});

describe("TaskEscalationEditor (AC-005)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "error" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><TaskEscalationEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
    expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument();
  });

  it("blocks create when no manager is set", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><TaskEscalationEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/manager role or user/i)).toBeInTheDocument();
    expect(aa.createTaskEscalationRule).not.toHaveBeenCalled();
  });

  it("creates a rule with threshold + a picked manager role (stored as a key)", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createTaskEscalationRule).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><TaskEscalationEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
    // The role picker is populated from the tenant directory.
    await waitFor(() =>
      expect(within(screen.getByLabelText(/manager role for rule 1/i)).getByRole("option", { name: "Operations Manager" })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText(/threshold minutes for rule 1/i), { target: { value: "600" } });
    fireEvent.change(screen.getByLabelText(/manager role for rule 1/i), { target: { value: "ops_manager" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(aa.createTaskEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(aa.createTaskEscalationRule).mock.calls[0][0]).toMatchObject({ thresholdMinutes: 600, managerRole: "ops_manager" });
  });

  // GAP-CRM-TASK-ESCALATION-01 — the manager role is now a SELECT fed by the
  // tenant roles; a mistyped/free-text role cannot be chosen. The picker only
  // offers real role keys, so an unknown role can never be submitted.
  it("the manager role picker offers only real roles — free text cannot be entered", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><TaskEscalationEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
    const roleSelect = (await screen.findByLabelText(/manager role for rule 1/i)) as HTMLSelectElement;
    expect(roleSelect.tagName).toBe("SELECT");
    const optionValues = within(roleSelect).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    // Only "No role" + the two real role keys — no free-text entry possible.
    expect(optionValues).toEqual(["", "sales_manager", "ops_manager"]);
  });

  // GAP-CRM-TASK-ESCALATION-01 — the user picker returns an id, and a saved rule
  // shows the resolved manager name plus a preview count of matching tasks.
  it("picks a manager user by id and shows the resolved name + overdue preview", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createTaskEscalationRule).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><TaskEscalationEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
    await waitFor(() =>
      expect(within(screen.getByLabelText(/manager user for rule 1/i)).getByRole("option", { name: "Priya Nair" })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText(/manager user for rule 1/i), { target: { value: "u-100" } });
    // Resolved name + preview count rendered.
    expect(screen.getByText(/Escalates to/)).toHaveTextContent("Priya Nair");
    expect(screen.getByText(/currently overdue/)).toHaveTextContent("2 tasks currently overdue");
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(aa.createTaskEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(aa.createTaskEscalationRule).mock.calls[0][0]).toMatchObject({ managerId: "u-100" });
  });

  // GAP-CRM-TASK-ESCALATION-01 — a saved rule whose role no longer exists is
  // flagged, not shown as if it were valid.
  it("flags a saved rule whose manager role no longer exists", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({
      data: [{ id: "e9", thresholdMinutes: 60, managerRole: "ghost_role", managerId: "", enabled: true }],
      source: "api",
    });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><TaskEscalationEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/fix this before it can escalate/i)).toBeInTheDocument());
    expect(screen.getByText(/Escalates to/)).toHaveTextContent('Unknown role "ghost_role"');
  });

  it("deletes a rule via ConfirmDialog", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(aa.deleteTaskEscalationRule).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><TaskEscalationEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByLabelText(/manager role for rule 1/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete rule 1/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete rule/i }));
    await waitFor(() => expect(aa.deleteTaskEscalationRule).toHaveBeenCalledWith("e1"));
  });
});
