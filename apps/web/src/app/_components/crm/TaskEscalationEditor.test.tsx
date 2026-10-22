import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TaskEscalationEditor } from "./TaskEscalationEditor";
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
  return {
    ...actual,
    getTaskEscalationRules: vi.fn(),
    createTaskEscalationRule: vi.fn(),
    updateTaskEscalationRule: vi.fn(),
    deleteTaskEscalationRule: vi.fn(),
    getEscalationRoles: vi.fn(),
    getEscalationUsers: vi.fn(),
    searchEscalationUsers: vi.fn(),
    getOverdueMatchCount: vi.fn(),
  };
});

const rule: aa.TaskEscalationRule = { id: "e1", name: "After a day", thresholdMinutes: 1440, managerRole: "sales_manager", managerId: "", enabled: true };

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
  vi.mocked(aa.searchEscalationUsers).mockReset();
  // GAP-CRM-TASK-ESCALATION-01: the preview is the server's count of tasks overdue by at least
  // THIS rule's threshold - one number per threshold, not the length of a capped list.
  vi.mocked(aa.getOverdueMatchCount).mockReset().mockImplementation(async (minutes: number) => ({
    data: minutes >= 2880 ? 1 : 2,
    source: "api" as const,
  }));
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

  it("creates a rule with threshold + a picked manager role (stored as a key)", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createTaskEscalationRule).mockResolvedValue(undefined);
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
    // The role picker is populated from the tenant directory.
    await waitFor(() =>
      expect(within(screen.getByLabelText(/manager role for rule 1/i)).getByRole("option", { name: "Operations Manager" })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText(/threshold unit for rule 1/i), { target: { value: "minutes" } });
    fireEvent.change(screen.getByLabelText(/threshold value for rule 1/i), { target: { value: "600" } });
    fireEvent.change(screen.getByLabelText(/manager role for rule 1/i), { target: { value: "ops_manager" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(aa.createTaskEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(aa.createTaskEscalationRule).mock.calls[0][0]).toMatchObject({ thresholdMinutes: 600, managerRole: "ops_manager" });
  });

  // GAP-CRM-TASK-ESCALATION-05 — entering a value in days converts to minutes.
  it("converts the threshold from the chosen unit to minutes, and echoes it", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createTaskEscalationRule).mockResolvedValue(undefined);
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
    fireEvent.change(screen.getByLabelText(/threshold unit for rule 1/i), { target: { value: "days" } });
    fireEvent.change(screen.getByLabelText(/threshold value for rule 1/i), { target: { value: "2" } });
    expect(screen.getByText("= 2 days")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/manager role for rule 1/i), { target: { value: "ops_manager" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(aa.createTaskEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(aa.createTaskEscalationRule).mock.calls[0][0]).toMatchObject({ thresholdMinutes: 2880 });
  });

  // GAP-CRM-TASK-ESCALATION-05 — two enabled rules with the same threshold AND
  // manager are rejected with an inline message.
  it("blocks a duplicate enabled rule (same threshold + manager)", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({
      data: [{ id: "e1", name: "After a day", thresholdMinutes: 1440, managerRole: "sales_manager", managerId: "", enabled: true }],
      source: "api",
    });
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getByLabelText(/manager role for rule 1/i)).toBeInTheDocument());
    // Add a second rule identical to the first (1440 min = 1 day, sales_manager).
    fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
    // New rule defaults to 1440 min; set its role to the same manager.
    fireEvent.change(screen.getByLabelText(/manager role for rule 2/i), { target: { value: "sales_manager" } });
    fireEvent.click(screen.getAllByRole("button", { name: /create/i })[0]);
    expect(await screen.findByText(/already escalates to this manager at the same threshold/i)).toBeInTheDocument();
    expect(aa.createTaskEscalationRule).not.toHaveBeenCalled();
  });

  // GAP-CRM-TASK-ESCALATION-01 — the manager role is now a SELECT fed by the
  // tenant roles; a mistyped/free-text role cannot be chosen. The picker only
  // offers real role keys, so an unknown role can never be submitted.
  it("the manager role picker offers only real roles — free text cannot be entered", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
    render(<TaskEscalationEditor />);
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
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
    await waitFor(() =>
      expect(within(screen.getByLabelText(/manager user for rule 1/i)).getByRole("option", { name: "Priya Nair" })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText(/manager user for rule 1/i), { target: { value: "u-100" } });
    // Resolved name + preview count rendered. The count is what THIS rule's threshold (1 day by
    // default) matches right now, from the server - not the length of a capped overdue list.
    expect(screen.getByText(/Escalates to/)).toHaveTextContent("Priya Nair");
    await waitFor(() => expect(screen.getByText(/already overdue by at least/)).toHaveTextContent("2 tasks are already overdue by at least this long"));
    expect(aa.getOverdueMatchCount).toHaveBeenCalledWith(1440);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(aa.createTaskEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(aa.createTaskEscalationRule).mock.calls[0][0]).toMatchObject({ managerId: "u-100" });
  });

  // GAP-CRM-TASK-ESCALATION-01 — a saved rule whose role no longer exists is
  // flagged, not shown as if it were valid.
  it("flags a saved rule whose manager role no longer exists", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({
      data: [{ id: "e9", name: "Ghost", thresholdMinutes: 60, managerRole: "ghost_role", managerId: "", enabled: true }],
      source: "api",
    });
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getByText(/fix this before it can escalate/i)).toBeInTheDocument());
    expect(screen.getByText(/Escalates to/)).toHaveTextContent('Unknown role "ghost_role"');
  });

  // GAP-CRM-TASK-ESCALATION-01 — crm-service REQUIRES a rule name and only knows recipientRole /
  // recipientId; the editor used to post neither, so every create 400'd.
  it("a new rule starts with a default name, and what is sent carries the name the reader gave it", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createTaskEscalationRule).mockResolvedValue(undefined);
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
    const name = screen.getByLabelText(/name for rule 1/i) as HTMLInputElement;
    expect(name.value).toBe("Escalate overdue tasks");
    fireEvent.change(name, { target: { value: "  Chase after two days " } });
    fireEvent.change(screen.getByLabelText(/manager user for rule 1/i), { target: { value: "u-200" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(aa.createTaskEscalationRule).toHaveBeenCalled());
    expect(vi.mocked(aa.createTaskEscalationRule).mock.calls[0][0]).toMatchObject({
      name: "Chase after two days",
      thresholdMinutes: 1440,
      managerId: "u-200",
      managerRole: "",
    });
  });

  it("blocks a rule with no name", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
    fireEvent.change(screen.getByLabelText(/manager user for rule 1/i), { target: { value: "u-200" } });
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/needs a name/i);
    expect(aa.createTaskEscalationRule).not.toHaveBeenCalled();
  });

  it("shows a saved rule's manager and name as read back from crm-service", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({
      data: [{ id: "e2", name: "Chase the head", thresholdMinutes: 2880, managerRole: "", managerId: "u-200", enabled: true }],
      source: "api",
    });
    render(<TaskEscalationEditor />);
    expect(await screen.findByDisplayValue("Chase the head")).toBeInTheDocument();
    expect((screen.getByLabelText(/manager user for rule 1/i) as HTMLSelectElement).value).toBe("u-200");
    expect(screen.getByText(/Escalates to/)).toHaveTextContent("Arjun Rao");
  });

  // GAP-CRM-TASK-ESCALATION-01 — each rule previews ITS OWN threshold's match count.
  it("previews a separate overdue count per rule threshold, asking the server once per distinct threshold", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({
      data: [
        { id: "a", name: "After a day", thresholdMinutes: 1440, managerRole: "sales_manager", managerId: "", enabled: true },
        { id: "b", name: "After two days", thresholdMinutes: 2880, managerRole: "ops_manager", managerId: "", enabled: true },
        { id: "c", name: "Also two days", thresholdMinutes: 2880, managerRole: "sales_manager", managerId: "", enabled: false },
      ],
      source: "api",
    });
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getAllByText(/already overdue by at least/)).toHaveLength(3));
    const previews = screen.getAllByText(/already overdue by at least/).map((el) => el.textContent);
    // Sorted by threshold: 1 day (2 matches), then the two 2-day rules (1 match each).
    expect(previews[0]).toContain("2 tasks are");
    expect(previews[1]).toContain("1 task is");
    expect(previews[2]).toContain("1 task is");
    expect(vi.mocked(aa.getOverdueMatchCount).mock.calls.map((c) => c[0]).sort((x, y) => x - y)).toEqual([1440, 2880]);
  });

  it("asks for a new count when a threshold is edited, and never for an invalid one", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(aa.getOverdueMatchCount).toHaveBeenCalledWith(1440));
    fireEvent.change(screen.getByLabelText(/threshold unit for rule 1/i), { target: { value: "hours" } });
    fireEvent.change(screen.getByLabelText(/threshold value for rule 1/i), { target: { value: "72" } });
    await waitFor(() => expect(aa.getOverdueMatchCount).toHaveBeenCalledWith(4320));
    const calls = vi.mocked(aa.getOverdueMatchCount).mock.calls.length;
    fireEvent.change(screen.getByLabelText(/threshold value for rule 1/i), { target: { value: "" } });
    await new Promise((r) => setTimeout(r, 450));
    expect(vi.mocked(aa.getOverdueMatchCount).mock.calls.length).toBe(calls);
  });

  it("falls back to the plain preview (no invented number) when the count cannot be loaded", async () => {
    vi.mocked(aa.getOverdueMatchCount).mockResolvedValue({ data: 0, source: "error" });
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(aa.getOverdueMatchCount).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText(/Escalates to/)).toHaveTextContent("Sales Manager");
    expect(screen.queryByText(/already overdue by at least/)).not.toBeInTheDocument();
  });

  // GAP-CRM-TASK-ESCALATION-01 — "keep server validation authoritative; surface its errors".
  it("words the server's refusal of a recipient in plain language, not a generic failure", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(aa.updateTaskEscalationRule).mockRejectedValue(new aa.TaskEscalationRuleRejected("INVALID_RECIPIENT_ROLE", "generic"));
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getByLabelText(/manager role for rule 1/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn.t one of this office.s roles any more/i);
  });

  it("says so when the role and user directory cannot be loaded, instead of showing silently empty pickers", async () => {
    vi.mocked(aa.getEscalationRoles).mockResolvedValue({ data: [], source: "error" });
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
    render(<TaskEscalationEditor />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be loaded, so a manager can.t be chosen/i);
    // Error colour comes from the design token, not a hard-coded hex.
    expect(alert.getAttribute("style")).toContain("var(--bad)");
    expect(alert.getAttribute("style")).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  // The user directory is bounded: on a large tenant the loaded list is only the first page. The picker says so
  // and searches the server, rather than quietly leaving people out of the choices.
  describe("a truncated user directory (large tenant)", () => {
    it("gives each rule's search box its own accessible name (the rule number), so the boxes can be told apart", async () => {
      vi.mocked(aa.getEscalationUsers).mockResolvedValue({ data: USERS, source: "api", truncated: true });
      vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({
        data: [rule, { ...rule, id: "e2", name: "After two days", thresholdMinutes: 2880 }],
        source: "api",
      });
      render(<TaskEscalationEditor />);
      expect(await screen.findByRole("searchbox", { name: "Search people by name for rule 1" })).toBeInTheDocument();
      expect(screen.getByRole("searchbox", { name: "Search people by name for rule 2" })).toBeInTheDocument();
      expect(screen.queryByRole("searchbox", { name: "Search people by name" })).not.toBeInTheDocument();
    });

    it("says the list is partial and offers a name search; a complete directory shows neither", async () => {
      vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
      const { unmount } = render(<TaskEscalationEditor />);
      await waitFor(() => expect(screen.getByLabelText(/manager user for rule 1/i)).toBeInTheDocument());
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
      unmount();

      vi.mocked(aa.getEscalationUsers).mockResolvedValue({ data: USERS, source: "api", truncated: true });
      render(<TaskEscalationEditor />);
      expect(await screen.findByRole("searchbox", { name: "Search people by name for rule 1" })).toBeInTheDocument();
      expect(screen.getByText("Showing the first 2 people. Search by name to find anyone else.")).toBeInTheDocument();
    });

    it("reaches a person the loaded page leaves out, and saves that person's id", async () => {
      vi.mocked(aa.getEscalationUsers).mockResolvedValue({ data: USERS, source: "api", truncated: true });
      vi.mocked(aa.searchEscalationUsers).mockResolvedValue({ data: [{ id: "u-900", name: "Zoya Khan" }], source: "api", truncated: false });
      vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [], source: "api" });
      vi.mocked(aa.createTaskEscalationRule).mockResolvedValue(undefined);
      render(<TaskEscalationEditor />);
      await waitFor(() => expect(screen.getByText(/no task-escalation rules yet/i)).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /add task-escalation rule/i }));
      fireEvent.change(await screen.findByRole("searchbox", { name: "Search people by name for rule 1" }), { target: { value: "zoya" } });
      await waitFor(() => expect(aa.searchEscalationUsers).toHaveBeenCalledWith("zoya"), { timeout: 3000 });
      const picker = screen.getByLabelText(/manager user for rule 1/i);
      await waitFor(() => expect(within(picker).getByRole("option", { name: "Zoya Khan" })).toBeInTheDocument());
      fireEvent.change(picker, { target: { value: "u-900" } });
      fireEvent.click(screen.getByRole("button", { name: /create/i }));
      await waitFor(() => expect(aa.createTaskEscalationRule).toHaveBeenCalled());
      expect(vi.mocked(aa.createTaskEscalationRule).mock.calls[0][0]).toMatchObject({ managerId: "u-900" });
    });

    it("does not call a saved manager 'unknown' just because they are not in the loaded page", async () => {
      const saved: aa.TaskEscalationRule = { id: "e7", name: "Beyond the page", thresholdMinutes: 60, managerRole: "", managerId: "u-900", enabled: true };
      vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [saved], source: "api" });
      // complete directory: the id really is unknown -> flagged
      const { unmount } = render(<TaskEscalationEditor />);
      await waitFor(() => expect(screen.getByText(/fix this before it can escalate/i)).toBeInTheDocument());
      expect(screen.getByText(/Escalates to/)).toHaveTextContent("Unknown user");
      unmount();

      // truncated directory: absence proves nothing -> not flagged, labelled honestly
      vi.mocked(aa.getEscalationUsers).mockResolvedValue({ data: USERS, source: "api", truncated: true });
      render(<TaskEscalationEditor />);
      await waitFor(() => expect(screen.getByText(/Escalates to/)).toHaveTextContent("Saved user (not in the loaded list)"));
      expect(screen.queryByText(/fix this before it can escalate/i)).not.toBeInTheDocument();
      expect(within(screen.getByLabelText(/manager user for rule 1/i)).getByRole("option", { name: "Saved user (not in the loaded list)" })).toBeInTheDocument();
    });
  });

  it("deletes a rule via ConfirmDialog", async () => {
    vi.mocked(aa.getTaskEscalationRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(aa.deleteTaskEscalationRule).mockResolvedValue(undefined);
    render(<TaskEscalationEditor />);
    await waitFor(() => expect(screen.getByLabelText(/manager role for rule 1/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete rule 1/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete rule/i }));
    await waitFor(() => expect(aa.deleteTaskEscalationRule).toHaveBeenCalledWith("e1"));
  });
});
