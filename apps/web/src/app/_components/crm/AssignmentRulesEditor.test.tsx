import { NextIntlClientProvider } from "next-intl";
import { renderWithIntl } from "@/lib/testUtils/intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AssignmentRulesEditor } from "./AssignmentRulesEditor";
import * as as from "@/lib/crm/assignment";

vi.mock("@/lib/crm/assignment", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/assignment")>();
  return {
    ...actual,
    getAssignmentRules: vi.fn(),
    createAssignmentRule: vi.fn(),
    updateAssignmentRule: vi.fn(),
    deleteAssignmentRule: vi.fn(),
    getAgents: vi.fn(),
  };
});
const AGENTS: as.AgentWorkload[] = [
  { agentId: "u1", name: "Asha Rao", activeLeads: 0, maxLeads: 10, available: true, onLeave: false },
  { agentId: "u-9", name: "Dev Kumar", activeLeads: 0, maxLeads: 10, available: true, onLeave: false },
];
const rule: as.AssignmentRule = { id: "r1", name: "West reps", ruleType: "territory", criteria: { territory: "west", ownerId: "u-9" }, ordinal: 0, enabled: true, fallbackOwnerId: "u1" };
beforeEach(() => {
  vi.mocked(as.getAssignmentRules).mockReset();
  vi.mocked(as.createAssignmentRule).mockReset();
  vi.mocked(as.updateAssignmentRule).mockReset();
  vi.mocked(as.deleteAssignmentRule).mockReset();
  vi.mocked(as.getAgents).mockReset();
  vi.mocked(as.getAgents).mockResolvedValue({ data: AGENTS, source: "api" });
});

describe("AssignmentRulesEditor (AS-001 admin)", () => {
  it("shows an error state (not an empty chain) and hides Add on a failed load (GAP-CRM-ASSIGNMENT-RULES-03)", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [], source: "error" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/couldn't load assignment rules/i)).toBeInTheDocument());
    // Must NOT fabricate an empty chain, and must not offer Add while blind.
    expect(screen.queryByText(/no assignment rules yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add rule/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("recovers from an error load when Retry succeeds (GAP-CRM-ASSIGNMENT-RULES-03)", async () => {
    vi.mocked(as.getAssignmentRules)
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValueOnce({ data: [rule], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/couldn't load assignment rules/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByDisplayValue("West reps")).toBeInTheDocument());
  });

  it("blocks create when criteria JSON is unparseable", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no assignment rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText(/criteria json for rule 1/i), { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect((await screen.findAllByText(/must be a json object/i)).length).toBeGreaterThan(0);
    expect(as.createAssignmentRule).not.toHaveBeenCalled();
  });

  it("blocks create when criteria is the wrong shape for the chosen strategy (GAP-CRM-ASSIGNMENT-RULES-01)", async () => {
    // {"foo":1} parses as JSON but is not a valid Territory criteria. The old
    // editor accepted it (only "is an object" was checked) and POSTed a rule
    // that would silently never match. It must now be blocked with an inline
    // per-strategy error, and browserFetch (createAssignmentRule) must not run.
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no assignment rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "Bad territory" } });
    fireEvent.change(screen.getByLabelText(/criteria json for rule 1/i), { target: { value: '{"foo":1}' } });
    // The row is a Territory row by default; an inline error must be visible.
    expect(await screen.findByText(/territory is required/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(as.createAssignmentRule).not.toHaveBeenCalled();
  });

  it("creates a new rule with parsed criteria", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(as.createAssignmentRule).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no assignment rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "South" } });
    fireEvent.change(screen.getByLabelText(/strategy for rule 1/i), { target: { value: "round_robin" } });
    fireEvent.change(screen.getByLabelText(/criteria json for rule 1/i), { target: { value: '{"roster":["u-1","u-2"],"currentIndex":0}' } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(as.createAssignmentRule).toHaveBeenCalled());
    expect(vi.mocked(as.createAssignmentRule).mock.calls[0][0]).toMatchObject({
      name: "South", ruleType: "round_robin", criteria: { roster: ["u-1", "u-2"], currentIndex: 0 },
    });
  });

  it("updates an existing rule (PUT with id)", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.updateAssignmentRule).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("West reps")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "West team" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(as.updateAssignmentRule).toHaveBeenCalledWith("r1", expect.objectContaining({ name: "West team" })));
  });

  it("deletes a rule only after ConfirmDialog confirmation", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.deleteAssignmentRule).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("West reps")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete rule 1/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete rule/i }));
    await waitFor(() => expect(as.deleteAssignmentRule).toHaveBeenCalledWith("r1"));
  });

  it("surfaces a failed update and does not claim the rule was saved", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.updateAssignmentRule).mockRejectedValue(new Error("CONFLICT: stale"));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("West reps")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "West team" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/conflict/i)).toBeInTheDocument();
    expect(screen.queryByText(/” saved\./i)).not.toBeInTheDocument();
  });

  it("renders the fallback owner's name, not a raw id, and keeps the id on save (GAP-CRM-ASSIGNMENT-RULES-02)", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.updateAssignmentRule).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    // The fallback owner id "u1" must resolve to "Asha Rao" via the directory.
    await waitFor(() => expect(screen.getByDisplayValue("Asha Rao")).toBeInTheDocument());
    // GAP-CRM-ASSIGNMENT-RULES-06: Save is dirty-gated, so make an edit first.
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "West reps 2" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(as.updateAssignmentRule).toHaveBeenCalled());
    // The persisted payload still carries the real id, never the display name.
    expect(vi.mocked(as.updateAssignmentRule).mock.calls[0][1]).toMatchObject({ fallbackOwnerId: "u1" });
  });

  it("blocks save and flags both rows when two rules share an order (GAP-CRM-ASSIGNMENT-RULES-04)", async () => {
    const r1: as.AssignmentRule = { id: "r1", name: "First", ruleType: "territory", criteria: { territory: "w", ownerId: "u1" }, ordinal: 1, enabled: true, fallbackOwnerId: "" };
    const r2: as.AssignmentRule = { id: "r2", name: "Second", ruleType: "territory", criteria: { territory: "e", ownerId: "u1" }, ordinal: 2, enabled: true, fallbackOwnerId: "" };
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [r1, r2], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("First")).toBeInTheDocument());
    // Make row 2's order collide with row 1 (both become 1).
    fireEvent.change(screen.getByLabelText(/order for rule 2/i), { target: { value: "1" } });
    expect((await screen.findAllByText(/order already used by/i)).length).toBeGreaterThan(0);
    // Save is disabled while a duplicate exists.
    expect(screen.getAllByRole("button", { name: /^save$/i })[0]).toBeDisabled();
    expect(as.updateAssignmentRule).not.toHaveBeenCalled();
  });

  it("Move up swaps ordinals and PUTs both rows (GAP-CRM-ASSIGNMENT-RULES-04)", async () => {
    const r1: as.AssignmentRule = { id: "r1", name: "First", ruleType: "territory", criteria: { territory: "w", ownerId: "u1" }, ordinal: 0, enabled: true, fallbackOwnerId: "" };
    const r2: as.AssignmentRule = { id: "r2", name: "Second", ruleType: "territory", criteria: { territory: "e", ownerId: "u1" }, ordinal: 1, enabled: true, fallbackOwnerId: "" };
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [r1, r2], source: "api" });
    vi.mocked(as.updateAssignmentRule).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("First")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /move rule 2 up/i }));
    await waitFor(() => expect(as.updateAssignmentRule).toHaveBeenCalledTimes(2));
    const ords = vi.mocked(as.updateAssignmentRule).mock.calls.map((c) => [c[0], (c[1] as as.AssignmentRule).ordinal]);
    // r2 takes ordinal 0, r1 takes ordinal 1.
    expect(ords).toEqual(expect.arrayContaining([["r2", 0], ["r1", 1]]));
  });

  it("confirms before an enable/disable flip takes effect (GAP-CRM-ASSIGNMENT-RULES-05)", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.updateAssignmentRule).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("West reps")).toBeInTheDocument());
    // Flip enabled off, then Save -> a confirm dialog must appear first.
    fireEvent.click(screen.getByLabelText(/enable rule 1/i));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/no longer route/i)).toBeInTheDocument();
    expect(as.updateAssignmentRule).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /turn off/i }));
    await waitFor(() => expect(as.updateAssignmentRule).toHaveBeenCalledWith("r1", expect.objectContaining({ enabled: false })));
  });

  it("shows the last-changed actor/date when the API returns it (GAP-CRM-ASSIGNMENT-RULES-05)", async () => {
    const withMeta: as.AssignmentRule = { ...rule, updatedBy: "Meera", updatedAt: "2026-09-01T10:00:00Z" };
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [withMeta], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("West reps")).toBeInTheDocument());
    expect(screen.getByText(/by Meera/i)).toBeInTheDocument();
  });
});

// GAP-CRM-ASSIGNMENT-RULES-06: per-row dirty marker + merge-after-save.
describe("AssignmentRulesEditor dirty markers (RULES-06)", () => {
  const r1: as.AssignmentRule = { id: "r1", name: "First", ruleType: "territory", criteria: { territory: "w", ownerId: "u1" }, ordinal: 0, enabled: true, fallbackOwnerId: "" };
  const r2: as.AssignmentRule = { id: "r2", name: "Second", ruleType: "territory", criteria: { territory: "e", ownerId: "u1" }, ordinal: 1, enabled: true, fallbackOwnerId: "" };

  it("disables Save on an unchanged row and shows no 'Unsaved' marker", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [r1], source: "api" });
    renderWithIntl(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("First")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("marks an edited row 'Unsaved' and enables its Save", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [r1], source: "api" });
    renderWithIntl(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("First")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "First edited" } });
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
  });

  it("saving row A keeps row B's unsaved edit and does not reload the whole chain", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [r1, r2], source: "api" });
    vi.mocked(as.updateAssignmentRule).mockResolvedValue(undefined);
    renderWithIntl(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("First")).toBeInTheDocument());
    // Edit B (ordinal 1 -> row 2 by sort) without saving.
    fireEvent.change(screen.getByLabelText(/name for rule 2/i), { target: { value: "Second edited" } });
    // Edit + save A (row 1).
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "First edited" } });
    const saveButtons = screen.getAllByRole("button", { name: /^save$/i });
    fireEvent.click(saveButtons[0]);
    await waitFor(() => expect(as.updateAssignmentRule).toHaveBeenCalledWith("r1", expect.objectContaining({ name: "First edited" })));
    // B's unsaved edit survives; getAssignmentRules not re-called for a reload.
    expect(screen.getByDisplayValue("Second edited")).toBeInTheDocument();
    expect(as.getAssignmentRules).toHaveBeenCalledTimes(1);
  });

  it("Discard restores a row to its loaded values", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [r1], source: "api" });
    renderWithIntl(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("First")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: /discard changes to rule 1/i }));
    expect(screen.getByDisplayValue("First")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });
});

// GAP-CRM-ASSIGNMENT-RULES-05/06: a row's unsaved edits are never lost or smuggled
// through another action (reorder / delete / create), and an unload warns.
describe("AssignmentRulesEditor unsaved-edit safety (RULES-05/06)", () => {
  const r1: as.AssignmentRule = { id: "r1", name: "First", ruleType: "territory", criteria: { territory: "w", ownerId: "u1" }, ordinal: 0, enabled: true, fallbackOwnerId: "" };
  const r2: as.AssignmentRule = { id: "r2", name: "Second", ruleType: "territory", criteria: { territory: "e", ownerId: "u1" }, ordinal: 1, enabled: true, fallbackOwnerId: "" };

  it("warns on page unload only while a row has unsaved edits", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const unloadAdds = () => add.mock.calls.filter((c) => c[0] === "beforeunload");
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [r1], source: "api" });
    renderWithIntl(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("First")).toBeInTheDocument());
    expect(unloadAdds()).toHaveLength(0); // clean => no guard

    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "First edited" } });
    expect(unloadAdds()).toHaveLength(1);
    const handler = unloadAdds()[0]![1] as (e: Event) => void;
    const ev = new Event("beforeunload", { cancelable: true });
    handler(ev);
    expect(ev.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /discard changes to rule 1/i }));
    expect(remove.mock.calls.some((c) => c[0] === "beforeunload")).toBe(true);
    add.mockRestore();
    remove.mockRestore();
  });

  it("deleting a row keeps another row's unsaved edit and does not reload the chain", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [r1, r2], source: "api" });
    vi.mocked(as.deleteAssignmentRule).mockResolvedValue(undefined);
    renderWithIntl(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("First")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "First edited" } });
    fireEvent.click(screen.getByRole("button", { name: /delete rule 2/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete rule/i }));
    await waitFor(() => expect(as.deleteAssignmentRule).toHaveBeenCalledWith("r2"));
    await waitFor(() => expect(screen.queryByDisplayValue("Second")).not.toBeInTheDocument());
    expect(screen.getByDisplayValue("First edited")).toBeInTheDocument();
    expect(as.getAssignmentRules).toHaveBeenCalledTimes(1);
  });

  it("Move persists only the ordinal swap, not an unsaved enabled flip, and keeps unsaved edits", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [r1, r2], source: "api" });
    vi.mocked(as.updateAssignmentRule).mockResolvedValue(undefined);
    renderWithIntl(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("First")).toBeInTheDocument());
    // Unsaved: rule 2 switched OFF (which would normally need a confirmation).
    fireEvent.click(screen.getByLabelText(/enable rule 2/i));
    fireEvent.click(screen.getByRole("button", { name: /move rule 2 up/i }));
    await waitFor(() => expect(as.updateAssignmentRule).toHaveBeenCalledTimes(2));
    const sent = new Map(
      vi.mocked(as.updateAssignmentRule).mock.calls.map((c) => [c[0], c[1] as as.AssignmentRule]),
    );
    // r2 moved to ordinal 0 but was persisted with its SAVED enabled=true.
    expect(sent.get("r2")).toMatchObject({ ordinal: 0, enabled: true });
    expect(sent.get("r1")).toMatchObject({ ordinal: 1, enabled: true });
    // No confirmation dialog, no reload, and the unsaved flip is still pending.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(as.getAssignmentRules).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByLabelText(/enable rule 1/i)).not.toBeChecked());
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  it("creating a rule while another saved row has unsaved edits yields one row per rule", async () => {
    const created: as.AssignmentRule = { id: "r3", name: "Third", ruleType: "territory", criteria: { territory: "n", ownerId: "u1" }, ordinal: 1, enabled: true, fallbackOwnerId: "" };
    vi.mocked(as.getAssignmentRules)
      .mockResolvedValueOnce({ data: [r1], source: "api" })
      .mockResolvedValueOnce({ data: [r1, created], source: "api" });
    vi.mocked(as.createAssignmentRule).mockResolvedValue(undefined);
    renderWithIntl(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("First")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "First edited" } });
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.change(screen.getByLabelText(/name for rule 2/i), { target: { value: "Third" } });
    fireEvent.change(screen.getByLabelText(/criteria json for rule 2/i), { target: { value: '{"territory":"n","ownerId":"u1"}' } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(as.createAssignmentRule).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: /^create$/i })).not.toBeInTheDocument());
    // First row's unsaved edit survived, exactly once; the new rule appears once.
    expect(screen.getAllByDisplayValue("First edited")).toHaveLength(1);
    expect(screen.getAllByDisplayValue("Third")).toHaveLength(1);
    // No duplicate-ordinal error blocks Save on any row.
    expect(screen.queryByText(/already used/i)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/^name for rule \d+$/i)).toHaveLength(2);
  });

  it("says 'Saved just now' (not an older actor/date) after saving a row", async () => {
    const withMeta: as.AssignmentRule = { ...r1, updatedBy: "Meera", updatedAt: "2026-09-01T10:00:00Z" };
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [withMeta], source: "api" });
    vi.mocked(as.updateAssignmentRule).mockResolvedValue(undefined);
    renderWithIntl(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByText(/by Meera/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "First edited" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(screen.getByText("Saved just now")).toBeInTheDocument());
    expect(screen.queryByText(/by Meera/i)).not.toBeInTheDocument();
  });
});

describe("normaliseRule last-changed actor (GAP-CRM-ASSIGNMENT-RULES-05)", () => {
  const base = { id: "r1", name: "R", ruleType: "territory", ordinal: 0, enabled: true, criteria: {} };
  const uuid = "3f2a1b4c-0000-4000-8000-000000000001";

  it("prefers the resolved display name over the raw user id", () => {
    const r = as.normaliseRule({ ...base, updatedBy: uuid, updatedByName: "Meera Rao", updatedAt: "2026-09-01T10:00:00Z" });
    expect(r?.updatedBy).toBe("Meera Rao");
    expect(r?.updatedAt).toBe("2026-09-01T10:00:00Z");
  });

  it("never surfaces a bare user id as the actor", () => {
    expect(as.normaliseRule({ ...base, updatedBy: uuid, updatedAt: "2026-09-01T10:00:00Z" })?.updatedBy).toBeUndefined();
    // A non-id display value from an older contract is still carried through.
    expect(as.normaliseRule({ ...base, updatedBy: "Meera" })?.updatedBy).toBe("Meera");
  });
});
