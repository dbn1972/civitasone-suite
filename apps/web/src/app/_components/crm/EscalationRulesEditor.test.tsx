import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { EscalationRulesEditor } from "./EscalationRulesEditor";
import * as as from "@/lib/crm/assignment";
import * as aa from "@/lib/crm/activityAccount";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

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
vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return {
    ...actual,
    getEscalationRoles: vi.fn(),
    getEscalationUsers: vi.fn(),
  };
});
const ROLES: aa.EscalationRole[] = [
  { key: "sales_manager", label: "Sales Manager" },
  { key: "lead_desk", label: "Lead Desk" },
];
const USERS: aa.EscalationUser[] = [{ id: "u1", name: "Asha Rao" }];
const rule: as.EscalationRule = { id: "e1", trigger: "unaccepted", thresholdMinutes: 60, recipientRole: "sales_manager", recipientId: "", reassign: true, enabled: true };
beforeEach(() => {
  vi.mocked(as.getEscalationRules).mockReset();
  vi.mocked(as.createEscalationRule).mockReset();
  vi.mocked(as.updateEscalationRule).mockReset();
  vi.mocked(as.deleteEscalationRule).mockReset();
  vi.mocked(aa.getEscalationRoles).mockReset().mockResolvedValue({ data: ROLES, source: "api" });
  vi.mocked(aa.getEscalationUsers).mockReset().mockResolvedValue({ data: USERS, source: "api" });
});

describe("EscalationRulesEditor (AS-004 admin)", () => {
  it("shows an error state (not an empty set) and hides Add on a failed load (GAP-CRM-ESCALATION-RULES-02)", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [], source: "error" });
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByText(/couldn't load escalation rules/i)).toBeInTheDocument());
    expect(screen.queryByText(/no escalation rules yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add escalation rule/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("picks the recipient role from the tenant directory, not free text (GAP-CRM-ESCALATION-RULES-01)", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(as.createEscalationRule).mockResolvedValue(undefined);
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add escalation rule/i }));
    // The role control is a SELECT populated from the directory.
    const roleSelect = await screen.findByLabelText(/recipient role for rule 1/i);
    expect(roleSelect.tagName).toBe("SELECT");
    expect(within(roleSelect as HTMLSelectElement).getByRole("option", { name: "Sales Manager" })).toBeInTheDocument();
    fireEvent.change(roleSelect, { target: { value: "lead_desk" } });
    fireEvent.change(screen.getByLabelText(/threshold for rule 1/i), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(as.createEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(as.createEscalationRule).mock.calls[0][0]).toMatchObject({ recipientRole: "lead_desk", thresholdMinutes: 120 });
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

  it("keeps unsaved edits in other rows when one row is saved (GAP-CRM-ESCALATION-RULES-03)", async () => {
    const r1: as.EscalationRule = { id: "e1", trigger: "unaccepted", thresholdMinutes: 60, recipientRole: "sales_manager", recipientId: "", reassign: false, enabled: true };
    const r2: as.EscalationRule = { id: "e2", trigger: "unattended", thresholdMinutes: 120, recipientRole: "lead_desk", recipientId: "", reassign: false, enabled: true };
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [r1, r2], source: "api" });
    vi.mocked(as.updateEscalationRule).mockResolvedValue(undefined);
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByLabelText(/threshold for rule 1/i)).toBeInTheDocument());
    // Edit row 2's threshold but do NOT save it.
    fireEvent.change(screen.getByLabelText(/threshold for rule 2/i), { target: { value: "999" } });
    // Save row 1.
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]);
    await waitFor(() => expect(as.updateEscalationRule).toHaveBeenCalled());
    // Row 2's unsaved edit must survive the merge-reload.
    await waitFor(() => expect((screen.getByLabelText(/threshold for rule 2/i) as HTMLInputElement).value).toBe("999"));
  });

  it("creates a rule with trigger + threshold + recipient", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(as.createEscalationRule).mockResolvedValue(undefined);
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add escalation rule/i }));
    fireEvent.change(screen.getByLabelText(/trigger for rule 1/i), { target: { value: "unattended" } });
    fireEvent.change(screen.getByLabelText(/threshold for rule 1/i), { target: { value: "120" } });
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
    await waitFor(() => expect(screen.getByRole("button", { name: /delete rule 1/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete rule 1/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete rule/i }));
    await waitFor(() => expect(as.deleteEscalationRule).toHaveBeenCalledWith("e1"));
  });

  it("surfaces a failed update and does not claim success", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.updateEscalationRule).mockRejectedValue(new Error("BAD_RECIPIENT: no"));
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByLabelText(/recipient role for rule 1/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/recipient role for rule 1/i), { target: { value: "lead_desk" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/bad_recipient/i)).toBeInTheDocument();
    expect(screen.queryByText(/escalation rule saved/i)).not.toBeInTheDocument();
  });

  // GAP-CRM-ESCALATION-RULES-04 — a unit select (minutes/hours/days) scales the
  // typed value into stored minutes, with a humanised preview.
  it("converts a 1-day threshold to 1440 stored minutes and previews it", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(as.createEscalationRule).mockResolvedValue(undefined);
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add escalation rule/i }));

    fireEvent.change(screen.getByLabelText(/threshold unit for rule 1/i), { target: { value: "days" } });
    fireEvent.change(screen.getByLabelText(/threshold for rule 1/i), { target: { value: "1" } });
    // Humanised preview.
    expect(screen.getByText(/= 1 day/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/recipient role for rule 1/i), { target: { value: "lead_desk" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(as.createEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(as.createEscalationRule).mock.calls[0][0]).toMatchObject({ thresholdMinutes: 1440 });
  });

  // GAP-CRM-ESCALATION-RULES-05 — a second rule identical to an existing one
  // (same trigger + threshold + recipient) is blocked client-side before any
  // request fires.
  it("blocks a duplicate rule and does not call the API", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.createEscalationRule).mockResolvedValue(undefined);
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByLabelText(/threshold for rule 1/i)).toBeInTheDocument());

    // Add a second row identical to the existing e1 (unaccepted / 60 / sales_manager).
    fireEvent.click(screen.getByRole("button", { name: /add escalation rule/i }));
    fireEvent.change(screen.getByLabelText(/threshold for rule 2/i), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText(/recipient role for rule 2/i), { target: { value: "sales_manager" } });
    fireEvent.click(screen.getAllByRole("button", { name: /create/i })[0]);

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(as.createEscalationRule).not.toHaveBeenCalled();
  });
});

describe("EscalationRulesEditor threshold bound (server cap 100,000 minutes)", () => {
  it("caps the threshold input at the cap in every unit and flags a value above it", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<EscalationRulesEditor />);
    const input = await screen.findByLabelText("Threshold for rule 1");
    expect(input).toHaveAttribute("max", "100000");
    const unit = screen.getByLabelText("Threshold unit for rule 1");
    fireEvent.change(unit, { target: { value: "hours" } });
    expect(screen.getByLabelText("Threshold for rule 1")).toHaveAttribute("max", "1666");
    fireEvent.change(unit, { target: { value: "days" } });
    const days = screen.getByLabelText("Threshold for rule 1");
    expect(days).toHaveAttribute("max", "69");
    expect(days).not.toHaveAttribute("aria-invalid");
    fireEvent.change(days, { target: { value: "70" } }); // 100,800 minutes
    expect(screen.getByLabelText("Threshold for rule 1")).toHaveAttribute("aria-invalid", "true");
  });
});
