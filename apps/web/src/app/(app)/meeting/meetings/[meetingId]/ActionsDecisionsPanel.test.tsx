import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

const c = vi.hoisted(() => ({
  acknowledgeActionItem: vi.fn().mockResolvedValue(undefined),
  assignActionItem: vi.fn().mockResolvedValue(undefined),
  fetchActionItems: vi.fn().mockResolvedValue([]),
  fetchDecisions: vi.fn().mockResolvedValue([]),
  recordDecision: vi.fn().mockResolvedValue(undefined),
  submitActionEvidence: vi.fn().mockResolvedValue(undefined),
  submitActionProgress: vi.fn().mockResolvedValue(undefined),
  updateActionItem: vi.fn().mockResolvedValue(undefined),
  verifyActionItem: vi.fn().mockResolvedValue(undefined),
  withdrawDecision: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../_data/client", () => c);
vi.mock("@/app/_components/EmployeePicker", () => ({
  EmployeePicker: (p: { onChange: (id: string | null) => void; "aria-label"?: string }) => (
    <button type="button" onClick={() => p.onChange("22222222-2222-4222-8222-222222222222")}>
      pick {p["aria-label"]}
    </button>
  ),
}));

import { ActionsDecisionsPanel, type ActionPermissions } from "./ActionsDecisionsPanel";
import type { ActionItem, Decision } from "../../_data/types";

const ASSIGNEE = "11111111-1111-4111-8111-111111111111";
const render = (ui: React.ReactElement) =>
  rtlRender(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>,
  );

const item = (over: Partial<ActionItem> = {}): ActionItem => ({
  id: "a1",
  meetingId: "m1",
  decisionId: null,
  agendaItemId: null,
  description: "Submit revised drainage estimate to the Executive Engineer",
  assigneeId: ASSIGNEE,
  deadline: "2026-12-15T10:00:00.000Z",
  priority: "high",
  slaHours: null,
  escalationLevel: 0,
  status: "assigned",
  evidenceUrl: null,
  evidenceNote: null,
  verifiedBy: null,
  verifiedAt: null,
  completedAt: null,
  acknowledgedAt: null,
  overdueAt: null,
  version: 3,
  ...over,
});
const decision: Decision = {
  id: "d1",
  meetingId: "m1",
  agendaItemId: null,
  text: "Approve revised estimate of Rs 48.6 lakh for Ward 14 drainage",
  type: "financial",
  authority: null,
  effectiveDate: null,
  status: "effective",
  responsibleOfficer: null,
  deadline: null,
  version: 2,
};
const none: ActionPermissions = {
  canAssign: false,
  canUpdate: false,
  canAssigneeAct: false,
  canVerify: false,
  canRecordDecision: false,
};
const people = { [ASSIGNEE]: { name: "Meera Iyer", designation: "Assistant Engineer" } };

function mount(over: { actions?: ActionItem[]; viewerId?: string | null; perms?: Partial<ActionPermissions> } = {}) {
  return render(
    <ActionsDecisionsPanel
      meetingId="m1"
      actionItems={over.actions ?? [item()]}
      actionItemsSource="api"
      decisions={[decision]}
      decisionsSource="api"
      agenda={[]}
      people={people}
      viewerId={over.viewerId === undefined ? ASSIGNEE : over.viewerId}
      permissions={{ ...none, ...over.perms }}
    />,
  );
}

beforeEach(() => Object.values(c).forEach((f) => f.mockClear()));

describe("ActionsDecisionsPanel", () => {
  it("lists decisions and action items with names, not ids", () => {
    mount();
    expect(screen.getByText(/Approve revised estimate/)).toBeInTheDocument();
    expect(screen.getByText(/Submit revised drainage estimate/)).toBeInTheDocument();
    expect(screen.getAllByText(/Meera Iyer/).length).toBeGreaterThan(0);
  });

  it("hides every write control from a read-only viewer", () => {
    mount({ perms: {} });
    expect(screen.queryByRole("button", { name: "Record decision" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign action item" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.queryByRole("button", { name: "Acknowledge assignment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("lets the assignee acknowledge, sending the item version", async () => {
    mount({ perms: { canAssigneeAct: true } });
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge assignment" }));
    await waitFor(() => expect(c.acknowledgeActionItem).toHaveBeenCalledWith("a1", 3));
  });

  it("does not offer assignee actions to someone who is not the assignee", () => {
    mount({ viewerId: "99999999-9999-4999-8999-999999999999", perms: { canAssigneeAct: true } });
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.queryByRole("button", { name: "Acknowledge assignment" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the assignee/)).toBeInTheDocument();
  });

  it("offers verify only once evidence is submitted, and sends the viewer as verifier", async () => {
    const chair = "33333333-3333-4333-8333-333333333333";
    mount({ actions: [item({ status: "evidence_submitted", evidenceNote: "Sanction letter attached" })], viewerId: chair, perms: { canVerify: true } });
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Verify completion" }));
    await waitFor(() => expect(c.verifyActionItem).toHaveBeenCalledWith("a1", { verifierId: chair, verified: true }));
  });

  it("a verifier who is also the assignee gets the self-verify hint and no Verify/Return buttons", () => {
    mount({ actions: [item({ status: "evidence_submitted", evidenceNote: "Sanction letter attached" })], viewerId: ASSIGNEE, perms: { canVerify: true } });
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.queryByRole("button", { name: "Verify completion" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Return to assignee" })).not.toBeInTheDocument();
    expect(screen.getByText(/You cannot verify an item assigned to yourself/)).toBeInTheDocument();
  });

  it("a verifier who is not the assignee sees Verify/Return and no self-verify hint", () => {
    mount({ actions: [item({ status: "evidence_submitted" })], viewerId: "33333333-3333-4333-8333-333333333333", perms: { canVerify: true } });
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("button", { name: "Verify completion" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return to assignee" })).toBeInTheDocument();
    expect(screen.queryByText(/You cannot verify an item assigned to yourself/)).not.toBeInTheDocument();
  });

  it("PATCH carries only the changed field plus version", async () => {
    mount({ perms: { canUpdate: true } });
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Priority", { selector: "#mtg-edit-priority" }), { target: { value: "critical" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(c.updateActionItem).toHaveBeenCalledWith("a1", 3, { priority: "critical" }));
  });

  it("assigns a new action item", async () => {
    mount({ actions: [], perms: { canAssign: true, employeeDirectory: "hrms" } });
    fireEvent.change(screen.getByLabelText("Action to be taken"), { target: { value: "Issue work order for Ward 14" } });
    fireEvent.click(screen.getByRole("button", { name: /pick Assignee/ }));
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2026-12-20T11:00" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Assign action item" })[0]!);
    await waitFor(() => expect(c.assignActionItem).toHaveBeenCalledTimes(1));
    const [, body] = c.assignActionItem.mock.calls[0]!;
    expect(body).toMatchObject({ description: "Issue work order for Ward 14", assigneeId: "22222222-2222-4222-8222-222222222222", priority: "medium" });
    expect(body.deadline).toMatch(/Z$/);
  });

  it("records and withdraws decisions for authorised roles", async () => {
    mount({ perms: { canRecordDecision: true, employeeDirectory: "none" } });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(c.withdrawDecision).toHaveBeenCalledWith("m1", "d1", 2));
    fireEvent.change(screen.getByLabelText("Decision text"), { target: { value: "Defer the road-widening item to the next meeting" } });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    await waitFor(() => expect(c.recordDecision).toHaveBeenCalledWith("m1", { text: "Defer the road-widening item to the next meeting", type: "general" }));
  });
});

describe("meetingActions i18n", () => {
  const E = (en as unknown as { meetingActions: Record<string, unknown> }).meetingActions;
  const H = (hi as unknown as { meetingActions: Record<string, unknown> }).meetingActions;
  const flat = (o: Record<string, unknown>, p = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
  const get = (o: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], o) as string;
  it("Hindi has every English key with the same placeholders", () => {
    for (const k of flat(E)) {
      expect(get(H, k), k).toBeTruthy();
      for (const ph of get(E, k).match(/\{\w+\}/g) ?? []) expect(get(H, k), k).toContain(ph);
    }
  });
});
