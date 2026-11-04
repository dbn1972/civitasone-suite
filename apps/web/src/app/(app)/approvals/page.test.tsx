import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@/test-utils/intl-render";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "token-abc" }) }),
  headers: () => new Map(),
}));

import ApprovalsPage from "./page";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tasks = [
  { id: id(1), instanceId: id(11), name: "Review", status: "pending", refType: "procurement_po", refId: id(21), dueAt: null, createdAt: "2026-11-01T00:00:00.000Z", instanceName: "Purchase Order Approval" },
  { id: id(2), instanceId: id(12), name: "Reporting Officer Approval", status: "pending", refType: "leave_app", refId: id(22), dueAt: "2020-01-01T00:00:00.000Z", createdAt: "2026-11-01T00:00:00.000Z", instanceName: "Leave Application" },
];
const counts = { waiting: 2, overdue: 1, sent: 4, done: 7 };

/** UX R1: /approvals is the unified inbox (GET /v1/workflow/inbox + POST /v1/workflow/ref-summaries). */
describe("ApprovalsPage (UX R1 unified inbox)", () => {
  const realFetch = globalThis.fetch;
  let summariesBody: unknown = null;
  beforeEach(() => {
    fetchJsonMock.mockReset();
    process.env.CIVITASONE_API_BASE_URL = "http://gw.test";
    summariesBody = null;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "http://gw.test/api/v1/workflow/ref-summaries") {
        summariesBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ data: [
          { refType: "procurement_po", refId: id(21), kind: "business", instanceId: id(11), instanceName: "Purchase Order Approval", reference: "PO/2026/0033", amountMinor: "12345600", fields: [], maker: { name: "Anita Verma", designation: "Section Officer" }, stage: { level: 2, of: 3, step: "Deputy Secretary" } },
          { refType: "leave_app", refId: id(22), kind: "business", instanceId: id(12), instanceName: "Leave Application", reference: null, amountMinor: null, fields: [{ key: "leaveType", value: "Earned Leave" }, { key: "days", value: "3" }], maker: { name: "Ravi Kumar", designation: "Assistant" }, stage: { level: 1, of: 1, step: "Reporting Officer Approval" } },
        ] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("loads the waiting tab (up to 200 rows), batches one summaries call, and renders business rows", async () => {
    fetchJsonMock.mockResolvedValue({ data: { tasks, total: 2, counts }, source: "api" });
    render(await ApprovalsPage({ searchParams: Promise.resolve({}) }));
    expect(String(fetchJsonMock.mock.calls[0]![0])).toBe("/api/v1/workflow/inbox?tab=waiting&limit=200&offset=0");
    expect(summariesBody).toEqual({ refs: [{ refType: "procurement_po", refId: id(21) }, { refType: "leave_app", refId: id(22) }] });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Approvals");
    const nav = screen.getByRole("navigation", { name: "Approval lists" });
    expect(within(nav).getByRole("link", { name: /Waiting for me\s*2/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /Sent by me\s*4/ })).toHaveAttribute("href", "/approvals?tab=sent");
    expect(within(nav).getByRole("link", { name: /Done by me\s*7/ })).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Approve leave: Earned Leave, 3 days");
    expect(rows[1]).toHaveTextContent("Approve purchase order PO/2026/0033");
    expect(rows[1]).toHaveTextContent("₹1,23,456.00");
    expect(screen.queryByText("Review")).toBeNull();
  });

  it("a module filter from an old queue bookmark narrows the server query; an unknown tab falls back to waiting", async () => {
    fetchJsonMock.mockResolvedValue({ data: { tasks: [], total: 0, counts }, source: "api" });
    render(await ApprovalsPage({ searchParams: Promise.resolve({ module: "procurement", tab: "bogus" }) }));
    const url = String(fetchJsonMock.mock.calls[0]![0]);
    expect(url).toContain("tab=waiting");
    expect(url).toContain("refType=procurement_indent&refType=procurement_po&refType=procurement_po_amendment&refType=procurement_plan");
    expect(screen.getByText("Nothing is waiting for you")).toBeInTheDocument();
  });

  it("the done tab asks for tab=done", async () => {
    fetchJsonMock.mockResolvedValue({ data: { tasks: [], total: 0, counts }, source: "api" });
    render(await ApprovalsPage({ searchParams: Promise.resolve({ tab: "done" }) }));
    expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("tab=done");
    expect(screen.getByText("No decisions in the last 30 days")).toBeInTheDocument();
  });

  it("a failed load shows the retry state from the error layer, with the tabs but no counts", async () => {
    fetchJsonMock.mockResolvedValue({ data: { tasks: [], total: 0, counts: null }, source: "error", status: 500 });
    render(await ApprovalsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Approval lists" });
    expect(within(nav).getByRole("link", { name: "Waiting for me" })).toBeInTheDocument();
  });
});
