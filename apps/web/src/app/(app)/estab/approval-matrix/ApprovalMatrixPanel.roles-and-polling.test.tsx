/**
 * Approver-role catalogue (GAP-ESTAB-APPROVAL-MATRIX-03) and async write feedback
 * (GAP-ESTAB-APPROVAL-MATRIX-06) for the Approval Matrix panel.
 *
 * The fetch mock answers by URL + method so a poll's answer is whatever the test scripts for that poll.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ApprovalMatrixPanel } from "./ApprovalMatrixPanel";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const RULE = {
  id: "r-new", module: "finance", sourceType: "finance_sanction", label: "Fresh band",
  minAmountMinor: 0, maxAmountMinor: null, workflowDefinitionCode: "finance.sanction.x",
  startNodeKey: "s", steps: [{ role: "director", label: "Director" }], priority: 100,
  active: true, updatedAt: "2026-09-01T00:00:00Z",
};

type Script = {
  /** Successive answers to GET /approval-rules: the first is the initial load, the rest are polls (last repeats). */
  reads: Array<unknown | Response>;
  catalogue?: { configured: boolean; roles: string[] };
  post?: Response;
  patch?: Response;
};

function installFetch(script: Script) {
  let reads = 0;
  const posts: unknown[] = [];
  const patches: unknown[] = [];
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/approval-rules") && method === "GET") {
      const answer = script.reads[Math.min(reads, script.reads.length - 1)];
      reads += 1;
      if (answer instanceof Response) return Promise.resolve(answer.clone());
      const rows = answer as unknown[];
      return Promise.resolve(jsonResponse({ data: rows, ...(script.catalogue ? { approverRoles: script.catalogue } : {}) }));
    }
    if (url.endsWith("/approval-rules") && method === "POST") {
      posts.push(JSON.parse(String(init?.body)));
      return Promise.resolve((script.post ?? jsonResponse({ id: "r-new", status: "accepted" }, 202)).clone());
    }
    if (/\/approval-rules\/[^/]+$/.test(url) && method === "PATCH") {
      patches.push(JSON.parse(String(init?.body)));
      return Promise.resolve((script.patch ?? jsonResponse({ id: "r-new", status: "accepted" }, 202)).clone());
    }
    return Promise.resolve(jsonResponse({}, 404));
  });
  return { fetchSpy, posts, patches, reads: () => reads };
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function fillRule(label = "Fresh band") {
  await screen.findByRole("button", { name: "Add rule" });
  fireEvent.change(screen.getByPlaceholderText(/PO sanction/i), { target: { value: label } });
  fireEvent.change(screen.getByPlaceholderText("finance.sanction.director_cto"), { target: { value: "finance.sanction.x" } });
}

describe("ApprovalMatrixPanel — approver-role catalogue (GAP-ESTAB-APPROVAL-MATRIX-03)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("Given a configured role list, Then roles are picked (no free-text list) and posted in the chosen order", async () => {
    const h = installFetch({
      reads: [[]],
      catalogue: { configured: true, roles: ["section_officer", "under_secretary", "deputy_secretary"] },
    });
    render(<ApprovalMatrixPanel />);
    await fillRule();
    expect(screen.queryByPlaceholderText("director, cto, ceo")).not.toBeInTheDocument();

    const select = screen.getByLabelText("Approver role to add");
    fireEvent.change(select, { target: { value: "under_secretary" } });
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    fireEvent.change(select, { target: { value: "section_officer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

    await waitFor(() => expect(h.posts).toHaveLength(1));
    expect((h.posts[0] as { steps: unknown }).steps).toEqual([
      { role: "under_secretary", label: "Under Secretary" },
      { role: "section_officer", label: "Section Officer" },
    ]);
  });

  it("Given a configured role list and no role chosen, Then nothing is posted and the message asks for a role", async () => {
    const h = installFetch({ reads: [[]], catalogue: { configured: true, roles: ["director"] } });
    render(<ApprovalMatrixPanel />);
    await fillRule();
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(await screen.findByText("Choose at least one approver role.")).toBeInTheDocument();
    expect(h.posts).toHaveLength(0);
  });

  it("Given no role list is configured, Then free text is kept, says it is format-checked only, and still refuses a malformed role", async () => {
    const h = installFetch({ reads: [[]], catalogue: { configured: false, roles: [] } });
    render(<ApprovalMatrixPanel />);
    await fillRule();
    expect(screen.getByText(/checked for format only/i)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("director, cto, ceo"), { target: { value: "Dep Secretary" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(await screen.findByText(/Enter at least one approver role as lowercase codes/)).toBeInTheDocument();
    expect(h.posts).toHaveLength(0);
  });

  it("a response without a catalogue (older service) behaves as 'not configured'", async () => {
    installFetch({ reads: [[]] });
    render(<ApprovalMatrixPanel />);
    await fillRule();
    expect(screen.getByPlaceholderText("director, cto, ceo")).toBeInTheDocument();
  });
});

describe("ApprovalMatrixPanel — async create keeps a Pending row until the rule lands (GAP-ESTAB-APPROVAL-MATRIX-06)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  async function submitRule() {
    await fillRule();
    fireEvent.change(screen.getByPlaceholderText("director, cto, ceo"), { target: { value: "director" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    await screen.findByText(/submitted\. It shows as Pending/);
  }

  it("Given the rule appears on the 3rd poll, Then the Pending row survives polls 1 and 2 (no Loading swap) and is replaced on the 3rd", async () => {
    const h = installFetch({ reads: [[], [], [], [RULE]] });
    render(<ApprovalMatrixPanel />);
    await submitRule();

    // Optimistic row is on screen straight away.
    expect(screen.getByText("Fresh band")).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);

    await tick(1000); // poll 1: read model still empty
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.getByText("Fresh band")).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);

    await tick(1000); // poll 2: still empty
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.getByText("Fresh band")).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);

    await tick(1000); // poll 3: the rule is there
    await waitFor(() => expect(screen.getByText(/added to the matrix/)).toBeInTheDocument());
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.getAllByText("Fresh band")).toHaveLength(1); // the pending row was replaced, not duplicated
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(h.reads()).toBe(4); // initial load + three polls; it stopped
    await tick(10_000);
    expect(h.reads()).toBe(4);
  });

  it("Given the rule never appears, Then after the poll limit it says 'still processing' and stops polling", async () => {
    const h = installFetch({ reads: [[]] });
    render(<ApprovalMatrixPanel />);
    await submitRule();
    for (let i = 0; i < 5; i += 1) await tick(1000);
    await waitFor(() => expect(screen.getByText(/Still processing — refresh in a moment to see the change\./)).toBeInTheDocument());
    // The rule is still shown as pending: nothing claims it was added.
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.queryByText(/added to the matrix/)).not.toBeInTheDocument();
    expect(h.reads()).toBe(6); // initial + 5 polls
    await tick(10_000);
    expect(h.reads()).toBe(6);
  });

  it("a poll that fails does not turn the matrix into an error state or lose the Pending row", async () => {
    installFetch({ reads: [[], new Response("", { status: 500 }), [RULE]] });
    render(<ApprovalMatrixPanel />);
    await submitRule();
    await tick(1000); // poll 1: 500
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByText("Fresh band")).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    await tick(1000); // poll 2: ok
    await waitFor(() => expect(screen.getByText(/added to the matrix/)).toBeInTheDocument());
  });

  it("clears its timers when the page is closed", async () => {
    const h = installFetch({ reads: [[]] });
    const { unmount } = render(<ApprovalMatrixPanel />);
    await submitRule();
    await tick(1000);
    const seen = h.reads();
    unmount();
    await tick(10_000);
    expect(h.reads()).toBe(seen);
  });

  it("matches the accepted rule by the id the service returned, not by its label", async () => {
    // An older rule with the same label + action already exists; it must not count as the new one.
    const older = { ...RULE, id: "old-1", minAmountMinor: 0, maxAmountMinor: 100_000 };
    installFetch({ reads: [[older], [older], [older], [older, { ...RULE, id: "r-new", minAmountMinor: 100_000 }]] });
    render(<ApprovalMatrixPanel />);
    await fillRule();
    fireEvent.change(screen.getByPlaceholderText("director, cto, ceo"), { target: { value: "director" } });
    const [minInput] = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(minInput, { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    await screen.findByText(/submitted\. It shows as Pending/);
    await tick(1000); // poll 1: only the older rule with the same label
    expect(screen.queryByText(/added to the matrix/)).not.toBeInTheDocument();
    await tick(1000); // poll 2: the older rule only
    expect(screen.queryByText(/added to the matrix/)).not.toBeInTheDocument();
    await tick(1000); // poll 3: the new id is there
    await waitFor(() => expect(screen.getByText(/added to the matrix/)).toBeInTheDocument());
  });
});

describe("ApprovalMatrixPanel — async toggle shows Pending, not the stale flag (GAP-ESTAB-APPROVAL-MATRIX-06)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  async function deactivate() {
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Deactivate")!);
    await screen.findByText(/Change to rule “Fresh band” submitted/);
  }

  it("Given the new flag lands on the 2nd poll, Then the row reads Pending (no action) until then and Inactive after", async () => {
    installFetch({ reads: [[RULE], [RULE], [{ ...RULE, active: false }]] });
    render(<ApprovalMatrixPanel />);
    await deactivate();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();

    await tick(1000); // poll 1: stale flag
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.queryByText("Active")).not.toBeInTheDocument();

    await tick(1000); // poll 2: applied
    await waitFor(() => expect(screen.getByText("Rule “Fresh band” deactivated.")).toBeInTheDocument());
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
  });

  it("Given the flag never changes, Then after the polls the row returns to the real flag with a 'still processing' message", async () => {
    installFetch({ reads: [[RULE]] });
    render(<ApprovalMatrixPanel />);
    await deactivate();
    for (let i = 0; i < 5; i += 1) await tick(1000);
    await waitFor(() => expect(screen.getByText(/Still processing/)).toBeInTheDocument());
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });
});
