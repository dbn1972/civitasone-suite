import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { EscalationRulesEditor } from "./EscalationRulesEditor";
import * as as from "@/lib/crm/assignment";

vi.mock("@/lib/crm/assignment", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/assignment")>();
  return {
    ...actual,
    getEscalationRules: vi.fn(),
    createEscalationRule: vi.fn(),
    updateEscalationRule: vi.fn(),
    deleteEscalationRule: vi.fn(),
  };
});
const rule: as.EscalationRule = { id: "e1", trigger: "unaccepted", thresholdMinutes: 60, recipientRole: "sales_manager", recipientId: "", reassign: true, enabled: true };
beforeEach(() => {
  vi.mocked(as.getEscalationRules).mockReset();
  vi.mocked(as.createEscalationRule).mockReset();
  vi.mocked(as.updateEscalationRule).mockReset();
  vi.mocked(as.deleteEscalationRule).mockReset();
});

describe("EscalationRulesEditor (AS-004 admin)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [], source: "error" });
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByText(/showing saved information/i)).toBeInTheDocument());
    expect(screen.getByText(/no escalation rules yet/i)).toBeInTheDocument();
  });

  it("blocks create when no recipient is set", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [], source: "api" });
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add escalation rule/i }));
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/recipient role or user/i)).toBeInTheDocument();
    expect(as.createEscalationRule).not.toHaveBeenCalled();
  });

  it("creates a rule with trigger + threshold + recipient", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(as.createEscalationRule).mockResolvedValue(undefined);
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add escalation rule/i }));
    fireEvent.change(screen.getByLabelText(/trigger for rule 1/i), { target: { value: "unattended" } });
    fireEvent.change(screen.getByLabelText(/threshold minutes for rule 1/i), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText(/recipient role for rule 1/i), { target: { value: "lead_desk" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(as.createEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(as.createEscalationRule).mock.calls[0][0]).toMatchObject({
      trigger: "unattended", thresholdMinutes: 120, recipientRole: "lead_desk",
    });
  });

  it("deletes a rule via ConfirmDialog", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.deleteEscalationRule).mockResolvedValue(undefined);
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("sales_manager")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete rule 1/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete rule/i }));
    await waitFor(() => expect(as.deleteEscalationRule).toHaveBeenCalledWith("e1"));
  });
});
