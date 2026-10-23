import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { DelegationsPanel } from "./DelegationsPanel";
import { addDays } from "../_data/delegations";
import { todayIST } from "@/lib/formatters";

const ME = "11111111-1111-4111-8111-111111111111";
const ASHA = "22222222-2222-4222-8222-222222222222";
const RAVI = "33333333-3333-4333-8333-333333333333";
const NEW_ID = "99999999-9999-4999-8999-999999999999";
const TODAY = todayIST();
const ROLES = ["workflow_user", "estab_officer"];

/** A row exactly as GET /v1/workflow/delegations returns it (repo.toView). */
function row(over: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tenantId: "tttttttt-tttt-4ttt-8ttt-tttttttttttt",
    delegatorId: ME, delegateId: ASHA, fromDate: addDays(TODAY, -5), toDate: addDays(TODAY, 20), reason: "On leave",
    roles: ["workflow_user"], isActive: true, createdAt: "2026-10-01T10:00:00.000Z", ...over,
  };
}
const list = (rows: unknown[], total = rows.length) => new Response(JSON.stringify({ data: rows, total }), { status: 200 });
const err = (status: number, code: string) =>
  new Response(JSON.stringify({ code, message: "RAW SERVER TEXT do not show", correlationId: "c1", retryable: false }), { status });

type Call = { url: string; method: string; body: unknown };
let calls: Call[];

/** Routes the panel's fetches: list GETs by queue, the directory, POST and DELETE. */
function stub(opts: {
  lists?: Array<() => Response | Promise<Response>>;
  post?: () => Response;
  del?: () => Response;
}) {
  calls = [];
  const lists = [...(opts.lists ?? [() => list([])])];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/identity/users/directory")) {
      if (url.includes("ids=")) return new Response(JSON.stringify({ data: [{ id: ASHA, displayName: "Asha Rao" }, { id: RAVI, displayName: "Ravi Menon" }] }), { status: 200 });
      return new Response(JSON.stringify({ data: [{ id: ASHA, displayName: "Asha Rao" }] }), { status: 200 });
    }
    if (url.includes("/v1/workflow/delegations") && method === "POST") return (opts.post ?? (() => new Response(JSON.stringify({ id: NEW_ID, status: "accepted", correlationId: "c" }), { status: 202 })))();
    if (url.includes("/v1/workflow/delegations/") && method === "DELETE") return (opts.del ?? (() => new Response(JSON.stringify({ id: "x", status: "accepted", correlationId: "c" }), { status: 202 })))();
    if (url.includes("/v1/workflow/delegations")) {
      const next = lists.length > 1 ? lists.shift()! : lists[0]!;
      return next();
    }
    return new Response("{}", { status: 404 });
  });
}

const panel = (over: Partial<React.ComponentProps<typeof DelegationsPanel>> = {}) =>
  render(<DelegationsPanel userId={ME} roles={ROLES} pollDelayMs={1} {...over} />);

async function pickDelegate() {
  const combo = screen.getByRole("combobox", { name: /delegate/i });
  fireEvent.focus(combo);
  fireEvent.change(combo, { target: { value: "Asha" } });
  fireEvent.mouseDown(await screen.findByText("Asha Rao", { selector: "[role=option], [role=option] *, li, li *" }));
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("DelegationsPanel: list states are distinct", () => {
  it("shows a loading state (not empty, not an error) while the list is in flight", async () => {
    stub({ lists: [() => new Promise<Response>(() => {})] });
    panel();
    expect(await screen.findByText("Loading your delegations…")).toBeInTheDocument();
    expect(screen.queryByText("No active delegations")).not.toBeInTheDocument();
    expect(screen.queryByText("We couldn’t load your delegations.")).not.toBeInTheDocument();
  });

  it("shows an error with a working retry (not the empty state) when the list fails", async () => {
    stub({ lists: [() => new Response("boom", { status: 500 }), () => list([row()])] });
    panel();
    expect(await screen.findByText("We couldn’t load your delegations.")).toBeInTheDocument();
    expect(screen.queryByText("No active delegations")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Revoke delegation to/ })).toBeInTheDocument();
    expect(screen.queryByText("We couldn’t load your delegations.")).not.toBeInTheDocument();
  });

  it("shows an error, not an empty list, when the body is not the documented envelope", async () => {
    stub({ lists: [() => new Response(JSON.stringify({ unexpected: true }), { status: 200 })] });
    panel();
    expect(await screen.findByText("We couldn’t load your delegations.")).toBeInTheDocument();
  });

  it("shows two empty states when there are no delegations", async () => {
    stub({ lists: [() => list([])] });
    panel();
    expect(await screen.findByText("No active delegations")).toBeInTheDocument();
    expect(screen.getByText("Nothing expired or revoked yet")).toBeInTheDocument();
    expect(screen.queryByText("We couldn’t load your delegations.")).not.toBeInTheDocument();
  });

  it("asks the service for only my delegations and shows no client-side window note", async () => {
    stub({ lists: [() => list([row()], 350)] });
    panel();
    await screen.findByRole("button", { name: /Revoke delegation to/ });
    const listCalls = calls.filter((c) => c.method === "GET" && c.url.includes("/v1/workflow/delegations"));
    expect(listCalls.length).toBeGreaterThan(0);
    expect(listCalls.every((c) => c.url.includes("mine=true") && !c.url.includes("toMe"))).toBe(true);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("DelegationsPanel: my active and expired delegations", () => {
  it("lists my delegations (the service scopes the list to me), split into active and expired/revoked, with names", async () => {
    stub({
      lists: [() => list([
        row(),
        row({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", fromDate: addDays(TODAY, -40), toDate: addDays(TODAY, -10), reason: "Old" }),
        row({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", isActive: false, reason: "Cancelled" }),
      ])],
    });
    panel();
    const active = (await screen.findByText("Active and upcoming")).closest(".card") as HTMLElement;
    expect(await within(active).findByText("Asha Rao")).toBeInTheDocument();
    expect(within(active).getByText("On leave")).toBeInTheDocument();
    expect(within(active).getByText("Workflow user")).toBeInTheDocument();
    const history = screen.getByText("Expired and revoked").closest(".card") as HTMLElement;
    expect(within(history).getByText("Old")).toBeInTheDocument();
    expect(within(history).getByText("Cancelled")).toBeInTheDocument();
    expect(within(history).getByText("Expired")).toBeInTheDocument();
    expect(within(history).getByText("Revoked")).toBeInTheDocument();
    // Only the one active row can be revoked.
    expect(screen.getAllByRole("button", { name: /Revoke delegation to/ })).toHaveLength(1);
  });
});

describe("DelegationsPanel: Delegated to me tab", () => {
  it("loads ?toMe=true, shows who delegated, and offers no revoke or create form", async () => {
    const lists = [
      () => list([row()]),
      () => list([row({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", delegatorId: RAVI, delegateId: ME, reason: "Covering for Ravi" })]),
    ];
    stub({ lists });
    panel();
    await screen.findByRole("button", { name: /Revoke delegation to/ });
    fireEvent.click(screen.getByRole("tab", { name: "Delegated to me" }));
    expect(await screen.findByText("Covering for Ravi")).toBeInTheDocument();
    expect(await screen.findByText("Ravi Menon")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Delegated by" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revoke delegation to/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "New delegation" })).not.toBeInTheDocument();
    const toMeCall = calls.filter((c) => c.method === "GET" && c.url.includes("toMe=true"));
    expect(toMeCall).toHaveLength(1);
    expect(toMeCall[0]!.url).not.toContain("mine=true");
    // Back to my own list restores the revoke action and the form.
    fireEvent.click(screen.getByRole("tab", { name: "My delegations" }));
    expect(await screen.findByRole("button", { name: /Revoke delegation to/ })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "New delegation" })).toBeInTheDocument();
  });

  it("shows its own empty state when nothing is delegated to me", async () => {
    stub({ lists: [() => list([]), () => list([])] });
    panel();
    await screen.findByText("No active delegations");
    fireEvent.click(screen.getByRole("tab", { name: "Delegated to me" }));
    expect(await screen.findByText(/Nobody has delegated a role to you/)).toBeInTheDocument();
  });
});

describe("DelegationsPanel: form", () => {
  it("offers only the roles the session holds", async () => {
    stub({});
    panel({ roles: ["workflow_user", "estab_officer", "workflow_user"] });
    const group = screen.getByRole("group", { name: /Roles to delegate/ });
    expect(within(group).getAllByRole("checkbox").map((c) => (c.parentElement as HTMLElement).textContent)).toEqual(["Estab officer", "Workflow user"]);
    expect(screen.queryByRole("checkbox", { name: "Estab deputy secretary" })).not.toBeInTheDocument();
  });

  it("says so when the user holds no role", async () => {
    stub({});
    panel({ roles: [] });
    expect(screen.getByText("You do not currently hold any role you can delegate.")).toBeInTheDocument();
  });

  it("blocks an empty submit with inline errors and no POST", async () => {
    stub({});
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Create delegation" }));
    expect(await screen.findByText("Choose at least one role to delegate.")).toBeInTheDocument();
    expect(screen.getByText("Search for and select the person who will act for you.")).toBeInTheDocument();
    expect(screen.getByText("Enter an end date. Delegations cannot be open-ended.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("flags an end date more than 90 days out, live, naming the latest allowed date", async () => {
    stub({});
    panel();
    fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/End date/), { target: { value: "2026-12-31" } });
    expect(await screen.findByText(/A delegation can last at most 90 days\./)).toBeInTheDocument();
    expect(screen.getByText(/on or before 30 Dec 2026/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/End date/), { target: { value: "2026-12-30" } });
    await waitFor(() => expect(screen.queryByText(/A delegation can last at most 90 days\./)).not.toBeInTheDocument());
  });

  it("flags an end date before the start date", async () => {
    stub({});
    panel();
    fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: "2026-10-10" } });
    fireEvent.change(screen.getByLabelText(/End date/), { target: { value: "2026-10-09" } });
    expect(await screen.findByText("The end date must be on or after the start date.")).toBeInTheDocument();
  });

  it("refuses to delegate to yourself", async () => {
    stub({});
    panel({ userId: ASHA });
    fireEvent.click(screen.getByRole("checkbox", { name: "Workflow user" }));
    await pickDelegate();
    fireEvent.change(screen.getByLabelText(/End date/), { target: { value: addDays(TODAY, 10) } });
    fireEvent.click(screen.getByRole("button", { name: "Create delegation" }));
    expect(await screen.findByText("You cannot delegate to yourself. Choose someone else.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("posts roles, delegate, dates and reason, then confirms once the new row is visible", async () => {
    const to = addDays(TODAY, 30);
    stub({
      lists: [() => list([]), () => list([row({ id: NEW_ID, toDate: to, reason: "Training" })])],
    });
    panel();
    await screen.findByText("No active delegations");
    fireEvent.click(screen.getByRole("checkbox", { name: "Workflow user" }));
    await pickDelegate();
    fireEvent.change(screen.getByLabelText(/End date/), { target: { value: to } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "  Training  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create delegation" }));

    expect(await screen.findByText(/Done\. The change is now showing/)).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/proxy/v1/workflow/delegations");
    expect(post.body).toEqual({ delegateId: ASHA, roles: ["workflow_user"], fromDate: TODAY, toDate: to, reason: "Training" });
    expect(await screen.findByText("Training")).toBeInTheDocument();
  });

  it("omits reason when blank", async () => {
    const to = addDays(TODAY, 5);
    stub({});
    panel();
    await screen.findByText("No active delegations");
    fireEvent.click(screen.getByRole("checkbox", { name: "Estab officer" }));
    await pickDelegate();
    fireEvent.change(screen.getByLabelText(/End date/), { target: { value: to } });
    fireEvent.click(screen.getByRole("button", { name: "Create delegation" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ delegateId: ASHA, roles: ["estab_officer"], fromDate: TODAY, toDate: to });
  });
});

describe("DelegationsPanel: server error codes map to friendly messages", () => {
  const cases: Array<[number, string, RegExp]> = [
    [403, "DELEGATION_ROLE_NOT_HELD", /You can only delegate roles you currently hold\. Your access may have changed\./],
    [400, "DELEGATION_TOO_LONG", /A delegation can last at most 90 days\. Shorten the period and try again\./],
    [400, "DELEGATION_BAD_RANGE", /The end date must be on or after the start date\. Correct the dates and try again\./],
  ];
  for (const [status, code, text] of cases) {
    it(`${code} -> friendly text, never the raw server message`, async () => {
      stub({ post: () => err(status, code) });
      panel();
      await screen.findByText("No active delegations");
      fireEvent.click(screen.getByRole("checkbox", { name: "Workflow user" }));
      await pickDelegate();
      fireEvent.change(screen.getByLabelText(/End date/), { target: { value: addDays(TODAY, 10) } });
      fireEvent.click(screen.getByRole("button", { name: "Create delegation" }));
      const alert = await screen.findByText(text);
      expect(alert).toHaveAttribute("role", "alert");
      expect(screen.queryByText(/RAW SERVER TEXT/)).not.toBeInTheDocument();
      expect(screen.queryByText(code)).not.toBeInTheDocument();
    });
  }

  it("an unmapped failure shows the shared plain-language copy, not raw text or a status", async () => {
    stub({ post: () => err(500, "INTERNAL") });
    panel();
    await screen.findByText("No active delegations");
    fireEvent.click(screen.getByRole("checkbox", { name: "Workflow user" }));
    await pickDelegate();
    fireEvent.change(screen.getByLabelText(/End date/), { target: { value: addDays(TODAY, 10) } });
    fireEvent.click(screen.getByRole("button", { name: "Create delegation" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => /couldn.t save/i.test(a.textContent ?? ""))).toBe(true));
    expect(screen.queryByText(/RAW SERVER TEXT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/500|INTERNAL/)).not.toBeInTheDocument();
  });
});

describe("DelegationsPanel: revoke", () => {
  it("asks for confirmation; cancel sends nothing", async () => {
    stub({ lists: [() => list([row()])] });
    panel();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke delegation to Asha Rao" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Revoke this delegation?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("DELETEs the delegation on confirm and moves it to history once applied", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    stub({ lists: [() => list([row()]), () => list([row({ isActive: false })])] });
    panel();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke delegation to Asha Rao" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke delegation" }));
    expect(await screen.findByText(/Done\. The change is now showing/)).toBeInTheDocument();
    const del = calls.find((c) => c.method === "DELETE")!;
    expect(del.url).toBe(`/api/proxy/v1/workflow/delegations/${id}`);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Revoke delegation to/ })).not.toBeInTheDocument());
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.getByText("No active delegations")).toBeInTheDocument();
  });

  it("keeps the dialog open with a friendly message when the delegation is gone (404)", async () => {
    stub({ lists: [() => list([row()])], del: () => err(404, "NOT_FOUND") });
    panel();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke delegation to Asha Rao" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke delegation" }));
    expect(await screen.findByText("This delegation no longer exists. Refresh the list.")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByText(/RAW SERVER TEXT/)).not.toBeInTheDocument();
  });

  it("offers no Revoke on expired or revoked rows", async () => {
    stub({ lists: [() => list([row({ toDate: addDays(TODAY, -1), fromDate: addDays(TODAY, -9) }), row({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", isActive: false })])] });
    panel();
    await screen.findByText("Expired and revoked");
    await waitFor(() => expect(screen.getAllByText("Asha Rao").length).toBe(2));
    expect(screen.queryByRole("button", { name: /Revoke delegation to/ })).not.toBeInTheDocument();
  });
});

describe("DelegationsPanel: legacy link", () => {
  it("shows the Legacy delegations link only when the caller is an admin", async () => {
    stub({});
    const { unmount } = panel({ canViewLegacy: true });
    expect(screen.getByRole("link", { name: "Legacy delegations" })).toHaveAttribute("href", "/workflow/delegations/legacy");
    unmount();
    panel({ canViewLegacy: false });
    expect(screen.queryByRole("link", { name: "Legacy delegations" })).not.toBeInTheDocument();
  });
});
