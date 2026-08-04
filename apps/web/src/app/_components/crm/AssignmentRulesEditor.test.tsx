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
const rule: as.AssignmentRule = { id: "r1", name: "West reps", ruleType: "territory", criteria: { region: "w" }, ordinal: 0, enabled: true, fallbackOwnerId: "u1" };
beforeEach(() => {
  vi.mocked(as.getAssignmentRules).mockReset();
  vi.mocked(as.createAssignmentRule).mockReset();
  vi.mocked(as.updateAssignmentRule).mockReset();
  vi.mocked(as.deleteAssignmentRule).mockReset();
});

describe("AssignmentRulesEditor (AS-001 admin)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [], source: "error" });
    render(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByText(/showing saved information/i)).toBeInTheDocument());
    expect(screen.getByText(/no assignment rules yet/i)).toBeInTheDocument();
  });

  it("blocks create when criteria JSON is invalid", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [], source: "api" });
    render(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no assignment rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText(/criteria json for rule 1/i), { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/valid json criteria/i)).toBeInTheDocument();
    expect(as.createAssignmentRule).not.toHaveBeenCalled();
  });

  it("creates a new rule with parsed criteria", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(as.createAssignmentRule).mockResolvedValue(undefined);
    render(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByText(/no assignment rules yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "South" } });
    fireEvent.change(screen.getByLabelText(/strategy for rule 1/i), { target: { value: "round_robin" } });
    fireEvent.change(screen.getByLabelText(/criteria json for rule 1/i), { target: { value: '{"pool":"south"}' } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(as.createAssignmentRule).toHaveBeenCalled());
    expect(vi.mocked(as.createAssignmentRule).mock.calls[0][0]).toMatchObject({
      name: "South", ruleType: "round_robin", criteria: { pool: "south" },
    });
  });

  it("updates an existing rule (PUT with id)", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.updateAssignmentRule).mockResolvedValue(undefined);
    render(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("West reps")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "West team" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(as.updateAssignmentRule).toHaveBeenCalledWith("r1", expect.objectContaining({ name: "West team" })));
  });

  it("deletes a rule only after ConfirmDialog confirmation", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.deleteAssignmentRule).mockResolvedValue(undefined);
    render(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("West reps")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete rule 1/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete rule/i }));
    await waitFor(() => expect(as.deleteAssignmentRule).toHaveBeenCalledWith("r1"));
  });

  it("surfaces a failed update and does not claim the rule was saved", async () => {
    vi.mocked(as.getAssignmentRules).mockResolvedValue({ data: [rule], source: "api" });
    vi.mocked(as.updateAssignmentRule).mockRejectedValue(new Error("CONFLICT: stale"));
    render(<AssignmentRulesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("West reps")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for rule 1/i), { target: { value: "West team" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/conflict/i)).toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });
});
