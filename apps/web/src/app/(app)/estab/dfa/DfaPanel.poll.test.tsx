/**
 * GAP-ESTAB-DFA-06 — after a create or an action the DFA list is re-read by a bounded poll
 * (the write is applied asynchronously by a consumer), and that poll is safe:
 *
 *  - a create shows the new draft even when the read model lags (1.5 s here);
 *  - an action taken inside a status tab (e.g. Approve under "Pending Approval") is seen: the
 *    row LEAVES the tab, which is the effect, and no "still processing" note is added;
 *  - while it waits the panel says "Refreshing…";
 *  - it gives up after a bounded number of tries and says so;
 *  - one poll at a time: a newer action supersedes the older one;
 *  - unmount, or a change of tab, cancels the timer AND the in-flight fetch, and a response
 *    arriving afterwards cannot re-arm anything or touch state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { render, screen, fireEvent, within, waitFor } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { DfaPanel } from "./DfaPanel";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const dfa = (over: Record<string, unknown> = {}) => ({
  id: "dfa-1", dfaNo: "DFA/2026/0001", communicationType: "letter", subject: "Sanction of advance",
  status: "pending_approval", editable: false, recipientName: null, updatedAt: "2026-10-01T00:00:00Z",
  fileId: null, createdBy: "drafter-1", ...over,
});

type Call = { url: string; method: string; signal: AbortSignal | null | undefined };
let calls: Call[];
// The list reads made by the poll: every GET after the first write.
const polls = () => {
  const firstWrite = calls.findIndex((c) => c.method === "POST");
  return firstWrite < 0 ? [] : calls.slice(firstWrite + 1).filter((c) => c.method === "GET");
};
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function useFetch(handler: (url: string, method: string) => Response | Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, signal: init?.signal });
    return handler(url, method);
  });
}

async function approve(remarks = "Within the delegated limit.") {
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.change(within(dialog).getByLabelText("Approval remarks"), { target: { value: remarks } });
  const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Approve") as HTMLButtonElement;
  fireEvent.click(confirm);
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/approve"))).toBe(true));
  // The poll is armed once the 202 has been handled; "Refreshing…" is its visible marker.
  await screen.findByText("Refreshing…");
}

beforeEach(() => {
  calls = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DfaPanel — create followed by a lagging read model", () => {
  it("lists the new draft once the read model catches up (1.5 s), saying Refreshing… until then", async () => {
    let visibleAt = Infinity;
    const created = dfa({ id: "dfa-new", dfaNo: "DFA/2026/0099", subject: "A brand new letter", status: "draft", editable: true, createdBy: "viewer-1" });
    useFetch((_url, method) => {
      if (method === "POST") {
        visibleAt = Date.now() + 1500; // the consumer applies the write 1.5 s after the 202
        return json({ id: "dfa-new", status: "accepted", correlationId: "c-1" }, 202);
      }
      return json({ data: Date.now() >= visibleAt ? [created] : [] });
    });
    render(<DfaPanel canApprove canDraft viewerId="viewer-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "+ New draft" }));
    fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: "A brand new letter" } });
    fireEvent.change(screen.getByLabelText(/Draft body/i), { target: { value: "Text of the letter." } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("Refreshing…")).toBeInTheDocument();
    await advance(1000); // first poll: the read is still stale
    expect(screen.queryByText("DFA/2026/0099")).not.toBeInTheDocument();
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    await advance(1000); // second poll: 2 s after the write, past the 1.5 s lag
    expect(await screen.findByText("DFA/2026/0099")).toBeInTheDocument();
    expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument();
    expect(polls()).toHaveLength(2);
  });
});

describe("DfaPanel — an action taken inside a status tab", () => {
  it("sees the effect when the approved row leaves the Pending Approval tab: list refreshed, no still-processing note", async () => {
    let approved = false;
    useFetch((url, method) => {
      if (method === "POST") { approved = true; return json({ id: "dfa-1", status: "accepted", correlationId: "c" }, 202); }
      if (url.includes("status=pending_approval")) return json({ data: approved ? [] : [dfa()] });
      return json({ data: [dfa({ status: approved ? "approved" : "pending_approval" })] });
    });
    render(<DfaPanel canApprove canDraft viewerId="approver-2" />);
    fireEvent.click(await screen.findByRole("tab", { name: "Pending Approval" }));
    await screen.findByText("DFA/2026/0001");

    await approve();
    await advance(1000);

    await waitFor(() => expect(screen.queryByText("DFA/2026/0001")).not.toBeInTheDocument());
    expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument();
    expect(screen.queryByText(/Still processing/i)).not.toBeInTheDocument();
    expect(screen.getByText("Draft approved.")).toBeInTheDocument();
    expect(polls()).toHaveLength(1);
    expect(polls()[0]?.url).toContain("status=pending_approval");
  });

  it("the Approve POST carries the remarks the approver typed", async () => {
    let body = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", signal: init?.signal });
      if (init?.method === "POST") { body = String(init.body); return json({ id: "dfa-1", status: "accepted", correlationId: "c" }, 202); }
      return json({ data: [dfa()] });
    });
    render(<DfaPanel canApprove canDraft viewerId="approver-2" />);
    await approve("Cleared; see the file note of 3 Oct.");
    expect(JSON.parse(body)).toEqual({ reason: "Cleared; see the file note of 3 Oct." });
  });

  it("in the All view an unchanged row keeps the poll going; after 5 tries it stops and says so", async () => {
    useFetch((_url, method) => (method === "POST"
      ? json({ id: "dfa-1", status: "accepted", correlationId: "c" }, 202)
      : json({ data: [dfa()] })));
    render(<DfaPanel canApprove canDraft viewerId="approver-2" />);
    await approve();
    for (let i = 0; i < 4; i += 1) await advance(1000);
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    expect(polls()).toHaveLength(4);
    await advance(1000);
    expect(polls()).toHaveLength(5);
    expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument();
    expect(screen.getByText(/Draft approved\. Still processing — refresh the list in a moment\./)).toBeInTheDocument();
    await advance(10_000);
    expect(polls()).toHaveLength(5); // it really stopped
  });
});

describe("DfaPanel — one poll at a time", () => {
  it("a newer action supersedes the older poll: its fetch is aborted and only one poll chain runs", async () => {
    const two = [dfa(), dfa({ id: "dfa-2", dfaNo: "DFA/2026/0002", subject: "Second one" })];
    useFetch((_url, method) => (method === "POST"
      ? json({ id: "x", status: "accepted", correlationId: "c" }, 202)
      : json({ data: two })));
    render(<DfaPanel canApprove canDraft viewerId="approver-2" />);
    await screen.findByText("DFA/2026/0002");

    // First action, let its poll fire and hang on an unresolved fetch.
    fireEvent.click(screen.getAllByRole("button", { name: "Return" })[0] as HTMLElement);
    let dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Reason for return"), { target: { value: "Please redraft" } });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Return") as HTMLElement);
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    await advance(1000);
    const firstPollSignal = polls()[0]?.signal;
    expect(firstPollSignal?.aborted).toBe(false);

    // Second action supersedes it.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Return" })[1] as HTMLElement);
    dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Reason for return"), { target: { value: "And this one too" } });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Return") as HTMLElement);
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));

    expect(firstPollSignal?.aborted).toBe(true);
    const before = polls().length;
    await advance(1000);
    expect(polls().length - before).toBe(1); // exactly one chain, not two
  });
});

describe("DfaPanel — cancelling a poll", () => {
  it("unmounting clears the pending timer, so no further request is ever made", async () => {
    useFetch((_url, method) => (method === "POST"
      ? json({ id: "dfa-1", status: "accepted", correlationId: "c" }, 202)
      : json({ data: [dfa()] })));
    const { unmount } = render(<DfaPanel canApprove canDraft viewerId="approver-2" />);
    await approve();
    const before = calls.length;
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(10_000);
    expect(calls.length).toBe(before);
  });

  it("unmounting while a poll fetch is in flight aborts it, and its late response re-arms nothing", async () => {
    let release: (r: Response) => void = () => undefined;
    useFetch((_url, method) => {
      if (method === "POST") return json({ id: "dfa-1", status: "accepted", correlationId: "c" }, 202);
      if (calls.filter((c) => c.method === "GET").length === 1) return json({ data: [dfa()] }); // initial load
      return new Promise<Response>((resolve) => { release = resolve; }); // the poll: held open
    });
    const { unmount } = render(<DfaPanel canApprove canDraft viewerId="approver-2" />);
    await approve();
    await advance(1000);
    expect(polls()).toHaveLength(1);
    const signal = polls()[0]?.signal;
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
    // The response arrives after unmount, still showing the row unchanged: the old code would
    // have scheduled another timer here.
    await act(async () => { release(json({ data: [dfa()] })); await Promise.resolve(); });
    expect(vi.getTimerCount()).toBe(0);
    const before = calls.length;
    await advance(10_000);
    expect(calls.length).toBe(before);
  });

  it("switching tab while the POST is still in flight starts no poll for the tab that was left", async () => {
    let finishPost: (r: Response) => void = () => undefined;
    useFetch((_url, method) => (method === "POST"
      ? new Promise<Response>((resolve) => { finishPost = resolve; })
      : json({ data: [dfa()] })));
    render(<DfaPanel canApprove canDraft viewerId="approver-2" />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Approval remarks"), { target: { value: "Fine." } });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Approve") as HTMLElement);
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));

    fireEvent.click(screen.getByRole("tab", { name: "Draft" })); // leaves the All view; the POST is still pending
    await waitFor(() => expect(calls.some((c) => c.url.includes("status=draft"))).toBe(true));
    await act(async () => { finishPost(json({ id: "dfa-1", status: "accepted", correlationId: "c" }, 202)); });
    expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument();
    const before = calls.length;
    await advance(10_000);
    expect(calls.length).toBe(before);
  });

  it("switching tab ends the poll that belonged to the old tab", async () => {
    useFetch((_url, method) => (method === "POST"
      ? json({ id: "dfa-1", status: "accepted", correlationId: "c" }, 202)
      : json({ data: [dfa()] })));
    render(<DfaPanel canApprove canDraft viewerId="approver-2" />);
    await approve();
    await advance(1000);
    const signal = polls()[0]?.signal;
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Draft" }));
    await waitFor(() => expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument());
    expect(signal?.aborted).toBe(true);
    const staleViewPolls = calls.filter((c) => c.method === "GET" && !c.url.includes("status=draft")).length;
    await advance(10_000);
    expect(calls.filter((c) => c.method === "GET" && !c.url.includes("status=draft")).length).toBe(staleViewPolls);
  });
});
