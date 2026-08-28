import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TaskEscalationEditor } from "./TaskEscalationEditor";
import * as aa from "@/lib/crm/activityAccount";

vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, getTaskEscalationRules: vi.fn(), createTaskEscalationRule: vi.fn(), updateTaskEscalationRule: vi.fn(), deleteTaskEscalationRule: vi.fn() };
});

const rule: aa.TaskEscalationRule = { id: "e1", thresholdMinutes: 1440, managerRole: "sales_manager", managerId: "", enabled: true };

beforeEach(() => {
  vi.mocked(aa.getTaskEscalationRules).mockReset();
  vi.mocked(aa.createTaskEscalationRule).mockReset();
  vi.mocked(aa.updateTaskEscalationRule).mockReset();
  vi.mocked(aa.deleteTaskEscalationRule).mockReset();
});

describe("TaskEscalationEditor (AC-005)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "error" });
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
    expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument();
  });

  it("blocks create when no manager is set", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/manager role or user/i)).toBeInTheDocument();
    expect(aa.createTaskEscalationRule).not.toHaveBeenCalled();
  });

  it("creates a rule with threshold + manager role", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createTaskEscalationRule).mockResolvedValue(undefined);
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
    fireEvent.change(screen.getByLabelText(/threshold minutes for rule 1/i), { target: { value: "600" } });
    fireEvent.change(screen.getByLabelText(/manager role for rule 1/i), { target: { value: "ops_manager" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(aa.createTaskEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(aa.createTaskEscalationRule).mock.calls[0][0]).toMatchObject({ thresholdMinutes: 600, managerRole: "ops_manager" });
  });

  it("deletes a rule via ConfirmDialog", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(aa.deleteTaskEscalationRule).mockResolvedValue(undefined);
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("sales_manager")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete rule 1/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete rule/i }));
    await waitFor(() => expect(aa.deleteTaskEscalationRule).toHaveBeenCalledWith("e1"));
  });
});
