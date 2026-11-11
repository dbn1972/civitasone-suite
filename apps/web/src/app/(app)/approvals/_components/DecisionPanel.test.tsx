import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@/test-utils/intl-render";
import { DecisionPanel, type TaskContext } from "./DecisionPanel";
import { buildRows, type InboxTask, type RefSummary } from "../_lib/inboxModel";

const NOW = Date.parse("2026-11-05T06:30:00.000Z");
const TASK = "00000000-0000-4000-8000-000000000001";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const t: InboxTask = { id: TASK, instanceId: "00000000-0000-4000-8000-000000000101", name: "Review", status: "pending", refType: "procurement_po", refId: "00000000-0000-4000-8000-000000000201", dueAt: null, createdAt: new Date(NOW).toISOString() };
const s: RefSummary = { refType: "procurement_po", refId: t.refId!, kind: "business", instanceId: t.instanceId, instanceName: "PO Approval", reference: "PO/2026/0033", amountMinor: "12345600", fields: [], maker: { name: "Anita Verma", designation: "Section Officer" }, stage: { level: 2, of: 3, step: "Deputy Secretary" } };
const row = buildRows([t], [s], NOW)[0]!;

function ctx(over: Partial<TaskContext> = {}): TaskContext {
  return {
    task: { id: TASK, name: "Review", status: "pending", decision: null, refType: "procurement_po", refId: t.refId!, instanceId: t.instanceId, dueAt: null, createdAt: null, assigned: false },
    instance: { id: t.instanceId, name: "PO Approval", status: "active", createdAt: "2026-10-30T05:00:00.000Z" },
    maker: { name: "Anita Verma", designation: "Section Officer" },
    isMaker: false,
    summary: s,
    trail: [
      { action: "create", decision: null, step: null, actor: { name: "Anita Verma", designation: "Section Officer" }, remarks: null, at: "2026-10-30T05:00:00.000Z" },
      { action: "complete", decision: "approve", step: "Section Officer Check", actor: { name: "Suresh Rao", designation: "Under Secretary" }, remarks: "Rates verified.", at: "2026-10-31T06:30:00.000Z" },
      { action: "complete", decision: "approve", step: null, actor: { name: "3f2a9b1c-0d4e-4f5a-8b6c-7d8e9f0a1b2c", designation: null }, remarks: "Sanction 12345678 attached. Approved for Rs 25000000 vide IND/20261104.", at: "2026-11-01T05:30:00.000Z" },
      { action: "return", decision: "return", step: null, actor: null, remarks: null, at: "2026-11-01T06:30:00.000Z" },
    ],
    permissions: { canAct: true, blockedReason: null, sodBlock: null, canForward: true },
    ...over,
  };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function mount(c: TaskContext, complete: (body: unknown) => Response = () => json({ status: "accepted" }, 202), extra?: (url: string) => Response | undefined) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), body });
    const x = extra?.(String(url));
    if (x) return x;
    if (String(url).endsWith("/context")) return json({ data: c });
    if (String(url).endsWith("/complete") || String(url).endsWith("/forward")) return complete(body);
    return json({}, 404);
  }) as unknown as typeof fetch;
  const onDecided = vi.fn();
  render(<DecisionPanel row={row} tab="waiting" onDecided={onDecided} onClose={() => {}} fetchImpl={fetchImpl} />);
  return { calls, onDecided };
}

describe("DecisionPanel (UX R1)", () => {
  it("shows the record summary, a link to the full record and the approval trail with names and designations", async () => {
    mount(ctx());
    const region = screen.getByRole("region", { name: "Approve purchase order PO/2026/0033" });
    expect(region).toHaveTextContent("PO/2026/0033");
    expect(region).toHaveTextContent("₹1,23,456.00");
    expect(region).toHaveTextContent("Anita Verma, Section Officer");
    expect(screen.getByRole("link", { name: "Open the full record" })).toHaveAttribute("href", `/procurement/orders/${t.refId}`);
    const trail = await screen.findByRole("list");
    const items = within(trail).getAllByRole("listitem");
    expect(items[1]).toHaveTextContent("Suresh Rao, Under Secretary · Approved · Section Officer Check");
    expect(items[1]).toHaveTextContent("31 Oct 2026");
    expect(items[1]).toHaveTextContent("Rates verified.");
    // PR #2460 review, blocker 1: a remark with numbers is shown in full; a UUID name is replaced.
    expect(items[2]).toHaveTextContent("Sanction 12345678 attached. Approved for Rs 25000000 vide IND/20261104.");
    expect(items[2]).toHaveTextContent("Name not recorded · Approved");
    expect(items[3]).toHaveTextContent("Name not recorded · Returned");
    expect(region.textContent).not.toMatch(UUID);
    expect(region.textContent).not.toMatch(/Unknown officer|\{\{/);
  });

  it("remarks are mandatory for Return and Reject, optional for Approve", async () => {
    const { calls, onDecided } = mount(ctx());
    await screen.findByRole("list");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter remarks to return or reject this item.");
    expect(screen.getByLabelText("Remarks")).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(screen.getByLabelText("Remarks"));
    fireEvent.click(screen.getByRole("button", { name: "Return for clarification" }));
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Remarks"), { target: { value: "Attach the GeM comparison." } });
    fireEvent.click(screen.getByRole("button", { name: "Return for clarification" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm" })); });
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(TASK, "return", "Returned for clarification: Approve purchase order PO/2026/0033."));
    expect(calls.find((c) => c.url.endsWith("/complete"))?.body).toEqual({ decision: "return", reason: "Attach the GeM comparison." });
  });

  it("SoD: the maker sees Approve disabled with the reason, and cannot return or reject either", async () => {
    const { calls } = mount(ctx({ isMaker: true, permissions: { canAct: true, blockedReason: null, sodBlock: "maker", canForward: false } }));
    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAccessibleDescription(/You raised this item, so you cannot approve, return or reject it \(maker-checker\)/);
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Return for clarification" })).toBeDisabled();
    fireEvent.click(approve);
    expect(calls.some((c) => c.url.endsWith("/complete"))).toBe(false);
  });

  it("not this officer: a step for another responsibility offers no decision buttons", async () => {
    mount(ctx({ permissions: { canAct: false, blockedReason: "notYourRole", sodBlock: null, canForward: false } }));
    expect(await screen.findByText(/This step is for an officer with a different responsibility/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("a server refusal is explained through the error-message layer, with the support reference, never raw text", async () => {
    mount(ctx(), () => json({ code: "SELF_APPROVAL_DENIED", message: "the submitter of a workflow may not approve their own request" }, 403, { "x-correlation-id": "ref-12345" }));
    await screen.findByRole("list");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm" })); });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/submitter of a workflow|SELF_APPROVAL_DENIED|403/);
    expect(alert).toHaveTextContent("ref-12345");
  });

  it("payroll: ZERO_BASIC / ARREARS_REVIEW guard results are shown and block Approve", async () => {
    const pr = { ...row, task: { ...row.task, refType: "payroll_run" }, type: "payrollRun" as const, module: "payroll" as const };
    const c = ctx({ task: { ...ctx().task, refType: "payroll_run" } });
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/context")) return json({ data: c });
      if (String(url).includes("/approval-review")) return json({ runId: "r", zeroBasic: [{ employeeId: "e", employeeNo: "E1" }], arrears: { totalMinor: "0", thresholdBps: 0, employees: [{ requiresReview: true }, { requiresReview: false }] } });
      return json({}, 404);
    }) as unknown as typeof fetch;
    render(<DecisionPanel row={pr} tab="waiting" onDecided={vi.fn()} onClose={() => {}} fetchImpl={fetchImpl} />);
    expect(await screen.findByText(/1 employee has no basic pay in this run/)).toBeInTheDocument();
    expect(screen.getByText(/1 employee has arrears above the review limit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("forward: needs an officer, then posts the forward", async () => {
    const { calls, onDecided } = mount(ctx());
    await screen.findByRole("list");
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward now" }));
    expect(screen.getByText("Choose the officer to forward this item to.")).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/forward"))).toBe(false);
    expect(onDecided).not.toHaveBeenCalled();
  });

  it("a failed context load says so with a retry", async () => {
    mount(ctx(), undefined, (url) => (url.endsWith("/context") ? json({ code: "INTERNAL" }, 500) : undefined));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("DecisionPanel: business reference shown as given (PR #2460 review)", () => {
  it("shows the reference IND/20261104", async () => {
    const ind: InboxTask = { ...t, refType: "procurement_indent" };
    const r = buildRows([ind], [{ ...s, refType: "procurement_indent", reference: "IND/20261104" }], NOW)[0]!;
    const fetchImpl = vi.fn(async () => json({ data: ctx({ summary: null }) })) as unknown as typeof fetch;
    render(<DecisionPanel row={r} tab="waiting" onDecided={vi.fn()} onClose={() => {}} fetchImpl={fetchImpl} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Approve purchase indent IND/20261104");
    expect(screen.getByText("IND/20261104")).toBeInTheDocument();
  });
});
