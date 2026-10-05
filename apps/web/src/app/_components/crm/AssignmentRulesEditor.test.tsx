import { NextIntlClientProvider } from "next-intl";
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
  };
});
const rule: as.AssignmentRule = { id: "r1", name: "West reps", ruleType: "territory", criteria: { territory: "west", ownerId: "u-9" }, ordinal: 0, enabled: true, fallbackOwnerId: "u1" };
beforeEach(() => {
  vi.mocked(as.getAssignmentRules).mockReset();
  vi.mocked(as.createAssignmentRule).mockReset();
  vi.mocked(as.updateAssignmentRule).mockReset();
  vi.mocked(as.deleteAssignmentRule).mockReset();
});

describe("AssignmentRulesEditor (AS-001 admin)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [], source: "error" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AssignmentRulesEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
    expect(screen.getByText(/no assignment rules yet/i)).toBeInTheDocument();
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
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });
});
