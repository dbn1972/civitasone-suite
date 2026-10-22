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
    getEscalationRecipients: vi.fn(),
    createEscalationRule: vi.fn(),
    updateEscalationRule: vi.fn(),
    deleteEscalationRule: vi.fn(),
  };
});
vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, searchEscalationUsers: vi.fn() };
});
const DIRECTORY: as.EscalationRecipientDirectory = {
  roles: [
    { key: "sales_manager", label: "Sales Manager" },
    { key: "lead_desk", label: "Lead Desk" },
  ],
  users: [{ id: "u1", name: "Asha Rao" }],
  rolesAvailable: true,
  usersAvailable: true,
  usersTruncated: false,
};
const NO_DIRECTORY: as.EscalationRecipientDirectory = {
  roles: [], users: [], rolesAvailable: false, usersAvailable: false, usersTruncated: false,
};
const rule: as.EscalationRule = { id: "e1", trigger: "unaccepted", thresholdMinutes: 60, recipientRole: "sales_manager", recipientId: "", reassign: true, enabled: true };
beforeEach(() => {
  vi.mocked(as.getEscalationRules).mockReset();
  vi.mocked(as.createEscalationRule).mockReset();
  vi.mocked(as.updateEscalationRule).mockReset();
  vi.mocked(as.deleteEscalationRule).mockReset();
  vi.mocked(as.getEscalationRecipients).mockReset().mockResolvedValue({ data: DIRECTORY, source: "api" });
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

// GAP-CRM-ESCALATION-RULES-01 -- a recipient can only be CHOSEN from the tenant
// directory. There is no free-text fallback: a mistyped role / stale user id used
// to save and the escalation then notified nobody.
describe("EscalationRulesEditor recipient directory (GAP-CRM-ESCALATION-RULES-01)", () => {
  it("an unknown role string cannot be saved (and the control is a picker, not a text box)", async () => {
    // A rule persisted earlier, when the role was free text, with a typo.
    const typo: as.EscalationRule = { ...rule, recipientRole: "sales_mangaer" };
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [typo], source: "api" });
    render(<EscalationRulesEditor />);
    const roleSelect = await screen.findByLabelText(/recipient role for rule 1/i);
    expect(roleSelect.tagName).toBe("SELECT");
    // The stale value is shown as UNKNOWN, not silently accepted.
    expect(within(roleSelect as HTMLSelectElement).getByRole("option", { name: /unknown role .sales_mangaer./i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/not in the directory/i)).toBeInTheDocument();
    expect(as.updateEscalationRule).not.toHaveBeenCalled();

    // Picking a real role clears the way.
    vi.mocked(as.updateEscalationRule).mockResolvedValue(undefined);
    fireEvent.change(roleSelect, { target: { value: "sales_manager" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(as.updateEscalationRule).toHaveBeenCalled());
  });

  it("never falls back to a free-text role or user input when the directory is unavailable", async () => {
    vi.mocked(as.getEscalationRecipients).mockResolvedValue({ data: NO_DIRECTORY, source: "error" });
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [], source: "api" });
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add escalation rule/i }));

    expect((await screen.findByLabelText(/recipient role for rule 1/i)).tagName).toBe("SELECT");
    expect(screen.getByLabelText(/recipient user for rule 1/i).tagName).toBe("SELECT");
    expect(screen.queryByPlaceholderText(/sales_manager/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/user id/i)).not.toBeInTheDocument();
    // The admin is told why the pickers are empty, with a retry.
    expect(screen.getByText(/couldn.t load the role and user directory/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry loading directory/i })).toBeInTheDocument();
  });

  it("refuses to save a recipient it cannot verify while the directory is unavailable, then saves after a retry", async () => {
    vi.mocked(as.getEscalationRecipients).mockResolvedValueOnce({ data: NO_DIRECTORY, source: "error" });
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.updateEscalationRule).mockResolvedValue(undefined);
    render(<EscalationRulesEditor />);
    await screen.findByLabelText(/recipient role for rule 1/i);
    // The saved role is shown as unverified, not as a known role.
    expect(screen.getByRole("option", { name: /not verified/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/directory could not be loaded.*not saved/i)).toBeInTheDocument();
    expect(as.updateEscalationRule).not.toHaveBeenCalled();

    // Retry succeeds (the default mock returns the full directory) -> the same save goes through.
    fireEvent.click(screen.getByRole("button", { name: /retry loading directory/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /retry loading directory/i })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(as.updateEscalationRule).toHaveBeenCalledWith("e1", expect.objectContaining({ recipientRole: "sales_manager" })));
  });

  it("flags a partly-available directory (roles ok, users not) and still verifies the roles that loaded", async () => {
    vi.mocked(as.getEscalationRecipients).mockResolvedValue({
      data: { ...DIRECTORY, users: [], usersAvailable: false },
      source: "api",
    });
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.updateEscalationRule).mockResolvedValue(undefined);
    render(<EscalationRulesEditor />);
    expect(await screen.findByText(/couldn.t load the user directory/i)).toBeInTheDocument();
    // A role-only rule is still verifiable and saves.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(as.updateEscalationRule).toHaveBeenCalled());
  });

  it("shows the recipient user by NAME, never the raw id, and saves the id chosen from the picker", async () => {
    const withUser: as.EscalationRule = { ...rule, recipientRole: "", recipientId: "u1" };
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [withUser], source: "api" });
    render(<EscalationRulesEditor />);
    const userSelect = (await screen.findByLabelText(/recipient user for rule 1/i)) as HTMLSelectElement;
    expect(userSelect.tagName).toBe("SELECT");
    // The saved rule reads "Asha Rao" ...
    expect(screen.getByDisplayValue("Asha Rao")).toBeInTheDocument();
    // ... and the opaque id is not shown anywhere as text.
    expect(screen.queryByText("u1")).not.toBeInTheDocument();
    expect(within(userSelect).queryByRole("option", { name: "u1" })).not.toBeInTheDocument();
  });

  it("picks a user from the directory for a new rule and sends that user's id", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(as.createEscalationRule).mockResolvedValue(undefined);
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add escalation rule/i }));
    fireEvent.change(await screen.findByLabelText(/recipient user for rule 1/i), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(as.createEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(as.createEscalationRule).mock.calls[0][0]).toMatchObject({ recipientId: "u1" });
  });

  it("lets a saved user through when the user list was truncated (the server is the authority)", async () => {
    const withUser: as.EscalationRule = { ...rule, recipientRole: "", recipientId: "u-not-in-first-page" };
    vi.mocked(as.getEscalationRecipients).mockResolvedValue({ data: { ...DIRECTORY, usersTruncated: true }, source: "api" });
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [withUser], source: "api" });
    vi.mocked(as.updateEscalationRule).mockResolvedValue(undefined);
    render(<EscalationRulesEditor />);
    expect(await screen.findByRole("option", { name: /not in the loaded list/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(as.updateEscalationRule).toHaveBeenCalled());
  });

  it("a truncated user list says so and is searched on the server, so a recipient beyond the loaded page can be chosen", async () => {
    vi.mocked(as.getEscalationRecipients).mockResolvedValue({ data: { ...DIRECTORY, usersTruncated: true }, source: "api" });
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(as.createEscalationRule).mockResolvedValue(undefined);
    vi.mocked(aa.searchEscalationUsers).mockReset().mockResolvedValue({ data: [{ id: "u-900", name: "Zoya Khan" }], source: "api", truncated: false });
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add escalation rule/i }));
    expect(await screen.findByText("Showing the first 1 person. Search by name to find anyone else.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search people by name for rule 1" }), { target: { value: "zoya" } });
    await waitFor(() => expect(aa.searchEscalationUsers).toHaveBeenCalledWith("zoya"), { timeout: 3000 });
    const picker = screen.getByLabelText(/recipient user for rule 1/i);
    await waitFor(() => expect(within(picker).getByRole("option", { name: "Zoya Khan" })).toBeInTheDocument());
    fireEvent.change(picker, { target: { value: "u-900" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(as.createEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(as.createEscalationRule).mock.calls[0][0]).toMatchObject({ recipientId: "u-900" });
  });

  it("gives each rule's search box its own accessible name, and the role / user labels come from i18n", async () => {
    vi.mocked(as.getEscalationRecipients).mockResolvedValue({ data: { ...DIRECTORY, usersTruncated: true }, source: "api" });
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [rule, { ...rule, id: "e2", thresholdMinutes: 120 }], source: "api" });
    render(<EscalationRulesEditor />);
    expect(await screen.findByRole("searchbox", { name: "Search people by name for rule 1" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search people by name for rule 2" })).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient role for rule 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient user for rule 2")).toBeInTheDocument();
  });

  it("the recipient labels are translated in Hindi too (no hard-coded English)", async () => {
    const hiMessages = (await import("@/messages/hi.json")).default as unknown as { crmEscalationRulesEditor: Record<string, string> };
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    rtlRender(
      <NextIntlClientProvider
        locale="hi"
        messages={{ ...enMessages, crmEscalationRulesEditor: { ...enMessages.crmEscalationRulesEditor, ...hiMessages.crmEscalationRulesEditor } }}
      >
        <EscalationRulesEditor />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByLabelText("नियम 1 के लिए प्राप्तकर्ता की भूमिका")).toBeInTheDocument();
    expect(screen.getByLabelText("नियम 1 के लिए प्राप्तकर्ता उपयोगकर्ता")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Recipient (role|user) for rule/)).not.toBeInTheDocument();
  });

  it("offers no search when the user list is complete", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<EscalationRulesEditor />);
    await screen.findByLabelText(/recipient user for rule 1/i);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("derives the rule name the server requires from trigger, threshold and recipient", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(as.createEscalationRule).mockResolvedValue(undefined);
    render(<EscalationRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add escalation rule/i }));
    fireEvent.change(screen.getByLabelText(/threshold for rule 1/i), { target: { value: "120" } });
    fireEvent.change(await screen.findByLabelText(/recipient role for rule 1/i), { target: { value: "lead_desk" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(as.createEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(as.createEscalationRule).mock.calls[0][0].name).toBe("Not accepted in time · 2 hours → Lead Desk");
  });

  it("explains a server-side refusal of the recipient (422) instead of claiming success", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.updateEscalationRule).mockRejectedValue(new as.EscalationRecipientError("invalid", "generic status text"));
    render(<EscalationRulesEditor />);
    await screen.findByLabelText(/recipient role for rule 1/i);
    fireEvent.change(screen.getByLabelText(/recipient role for rule 1/i), { target: { value: "lead_desk" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/not in the directory/i)).toBeInTheDocument();
    expect(screen.queryByText(/escalation rule saved/i)).not.toBeInTheDocument();
  });

  it("says the rule was NOT saved when the server could not verify the recipient (503)", async () => {
    vi.mocked(as.getEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.updateEscalationRule).mockRejectedValue(new as.EscalationRecipientError("unavailable", "generic status text"));
    render(<EscalationRulesEditor />);
    await screen.findByLabelText(/recipient role for rule 1/i);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/directory could not be loaded.*not saved/i)).toBeInTheDocument();
  });
});
