import { describe, it, expect, vi, beforeEach } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/approvals", useSearchParams: () => new URLSearchParams() }));
import { render, screen, fireEvent, waitFor, within, act } from "@/test-utils/intl-render";
import { ApprovalsInbox } from "./ApprovalsInbox";
import { COUNTS_EVENT, type InboxTask, type RefSummary } from "../_lib/inboxModel";
import type { TaskContext } from "./DecisionPanel";

const NOW = Date.parse("2026-11-05T06:30:00.000Z");
const DAY = 86_400_000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LABELS = { nav: "Approval lists", waiting: "Waiting for me", sent: "Sent by me", done: "Done by me" };

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function task(n: number, over: Partial<InboxTask> = {}): InboxTask {
  return { id: id(n), instanceId: id(100 + n), name: "Review", status: "pending", refType: "procurement_po", refId: id(200 + n), dueAt: new Date(NOW + 5 * DAY).toISOString(), createdAt: new Date(NOW - n * DAY).toISOString(), instanceName: "Purchase Order Approval", ...over };
}
function summary(t: InboxTask, over: Partial<RefSummary> = {}): RefSummary {
  return { refType: t.refType!, refId: t.refId!, kind: "business", instanceId: t.instanceId, instanceName: "Purchase Order Approval", reference: `PO/2026/${t.id.slice(-4)}`, amountMinor: "12345600", fields: [], maker: { name: "Anita Verma", designation: "Section Officer" }, stage: { level: 2, of: 3, step: "Deputy Secretary" }, ...over };
}
function ctxFor(taskId: string, over: Partial<TaskContext> = {}): TaskContext {
  return {
    task: { id: taskId, name: "Review", status: "pending", decision: null, refType: "procurement_po", refId: id(200), instanceId: id(100), dueAt: null, createdAt: null, assigned: false },
    instance: { id: id(100), name: "Purchase Order Approval", status: "active", createdAt: "2026-10-30T05:00:00.000Z" },
    maker: { name: "Anita Verma", designation: "Section Officer" },
    isMaker: false,
    summary: null,
    trail: [],
    permissions: { canAct: true, blockedReason: null, sodBlock: null, canForward: false },
    ...over,
  };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup(n = 3, fetchImpl?: typeof fetch) {
  const tasks = Array.from({ length: n }, (_, i) => task(i + 1));
  tasks[1] = { ...tasks[1]!, dueAt: new Date(NOW - 2 * DAY).toISOString() }; // overdue
  const summaries = tasks.map((t) => summary(t));
  const f = fetchImpl ?? (vi.fn(async (url: string) => {
    const m = /tasks\/([^/]+)\/(context|complete)/.exec(String(url));
    if (m?.[2] === "context") return json({ data: ctxFor(m[1]!) });
    if (m?.[2] === "complete") return json({ id: m[1], status: "accepted" }, 202);
    return json({}, 404);
  }) as unknown as typeof fetch);
  render(<ApprovalsInbox tab="waiting" tasks={tasks} summaries={summaries} counts={{ waiting: n, overdue: 1, sent: 0, done: 4 }} total={n} tabLabels={LABELS} now={NOW} fetchImpl={f} />);
  return { tasks, fetch: f };
}

beforeEach(() => { window.sessionStorage.clear(); push.mockReset(); });

describe("ApprovalsInbox rows (UX R1)", () => {
  it("each row names the task, reference, amount (Indian format), maker with designation, stage and SLA in words", () => {
    setup();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    // Overdue first.
    expect(rows[0]).toHaveTextContent("Approve purchase order PO/2026/0002");
    expect(rows[0]).toHaveTextContent("Overdue by 2 days");
    expect(rows[1]).toHaveTextContent("₹1,23,456.00");
    expect(rows[1]).toHaveTextContent("From: Anita Verma, Section Officer");
    expect(rows[1]).toHaveTextContent("Level 2 of 3: Deputy Secretary");
    expect(rows[1]).toHaveTextContent(/Due \d{2} Nov 2026/);
    expect(table.textContent).not.toMatch(UUID);
    expect(table.textContent).not.toMatch(/\bReview\b/);
    expect(within(table).getByText(/items waiting for your decision/)).toBeInTheDocument();
  });

  it("a row without business context still reads as a human task, never an id or Unknown", () => {
    const t = task(9, { refType: "asset_disposal", instanceName: "Asset Disposal Approval" });
    render(<ApprovalsInbox tab="waiting" tasks={[t]} summaries={[summary(t, { kind: "generic", reference: null, amountMinor: null, maker: null, instanceName: "Asset Disposal Approval" })]} counts={null} total={1} tabLabels={LABELS} now={NOW} />);
    const row = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    expect(row).toHaveTextContent("Decide: Asset Disposal Approval");
    expect(row).toHaveTextContent("Name not recorded");
    expect(row).toHaveTextContent("No amount");
    expect(row.textContent).not.toMatch(/Unknown|\{\{/);
  });

  it("tabs show the live counts and the badge event carries the same waiting count", () => {
    const seen: number[] = [];
    window.addEventListener(COUNTS_EVENT, (e) => seen.push((e as CustomEvent).detail.waiting));
    setup();
    const nav = screen.getByRole("navigation", { name: "Approval lists" });
    expect(within(nav).getByRole("link", { name: /Waiting for me\s*3/ })).toHaveAttribute("aria-current", "page");
    expect(seen.at(-1)).toBe(3);
  });

  it("filters by module, amount and reference, and announces the result", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Search by reference, subject or sender"), { target: { value: "0003" } });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("1 item listed, 0 overdue.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search by reference, subject or sender"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Amount from (₹)"), { target: { value: "500000" } });
    expect(screen.getByText("No items match these filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    // The module is a server filter: changing it reloads the tab narrowed to that module.
    fireEvent.change(screen.getByLabelText("Module"), { target: { value: "leave" } });
    expect(push).toHaveBeenCalledWith("/approvals?tab=waiting&module=leave");
  });

  it("J/K and the arrow keys move focus between rows; Enter (a native button) opens the panel", async () => {
    setup();
    const buttons = within(screen.getByRole("table")).getAllByRole("button");
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: "j" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[2]);
    fireEvent.keyDown(buttons[2]!, { key: "k" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.click(buttons[1]!);
    expect(await screen.findByRole("region", { name: "Approve purchase order PO/2026/0003" })).toBeInTheDocument();
  });

  it("after approving: the item leaves the list, the next item opens and takes focus, counts drop, the decision is announced", async () => {
    const seen: number[] = [];
    window.addEventListener(COUNTS_EVENT, (e) => seen.push((e as CustomEvent).detail.waiting));
    const { fetch } = setup();
    const first = within(screen.getByRole("table")).getAllByRole("button")[0]!;
    fireEvent.click(first);
    const panel = await screen.findByRole("region", { name: "Approve purchase order PO/2026/0002" });
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Approve" })).toBeEnabled());
    fireEvent.click(within(panel).getByRole("button", { name: "Approve" }));
    await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Confirm" })); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open: Approve purchase order PO/2026/0002" })).toBeNull());
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).endsWith(`/tasks/${id(2)}/complete`))).toBe(true);
    await screen.findByRole("region", { name: "Approve purchase order PO/2026/0003" });
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName("Open: Approve purchase order PO/2026/0003"));
    expect(within(screen.getByRole("navigation", { name: "Approval lists" })).getByRole("link", { name: /Waiting for me\s*2/ })).toBeInTheDocument();
    expect(seen.at(-1)).toBe(2);
    expect(screen.getByText(/Approved: Approve purchase order PO\/2026\/0002\. The next item is open\./)).toBeInTheDocument();
  });

  it("pages 200 tasks 25 at a time", () => {
    setup(200);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(26);
    const pager = screen.getByRole("navigation", { name: "Approval pages" });
    expect(pager).toHaveTextContent("Page 1 of 8");
    fireEvent.click(within(pager).getByRole("button", { name: "Next" }));
    expect(pager).toHaveTextContent("Page 2 of 8");
  });

  it("empty tab shows its own empty state", () => {
    render(<ApprovalsInbox tab="sent" tasks={[]} summaries={[]} counts={{ waiting: 0, overdue: 0, sent: 0, done: 0 }} total={0} tabLabels={LABELS} now={NOW} />);
    expect(screen.getByText("Nothing you raised is waiting")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("All chip counts what the filters select (PR #2460 review)", () => {
  it("unfiltered: the tab total; filtered by search: the filtered count", () => {
    setup();
    expect(screen.getByRole("button", { name: "All 3" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search by reference, subject or sender"), { target: { value: "0003" } });
    expect(screen.getByRole("button", { name: "All 1" })).toBeInTheDocument();
  });

  it("a server module filter shows the server total and keeps the module in the search form", () => {
    const tasks = [task(1), task(2)];
    render(<ApprovalsInbox tab="waiting" tasks={tasks} summaries={tasks.map((x) => summary(x))} counts={{ waiting: 9, overdue: 0, sent: 0, done: 0 }} total={2} initialModule="procurement" tabLabels={LABELS} now={NOW} />);
    expect(screen.getByRole("button", { name: "All 2" })).toBeInTheDocument();
    expect(document.querySelector("input[type=hidden][name=module]")).toHaveAttribute("value", "procurement");
  });
});
