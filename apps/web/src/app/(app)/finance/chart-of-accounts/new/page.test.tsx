import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import enMessages from "@/messages/en.json";

// The page reads its new copy through next-intl (financeChartOfAccountsNew / financeChartOfAccounts).
const withIntl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{children}</NextIntlClientProvider>
);
const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) => rtlRender(ui, { wrapper: withIntl, ...options });

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import MapHeadOfAccountPage from "./page";

const ACCOUNTS = [{ id: "acc-1", code: "2110", name: "Sundry Creditors" }];

describe("MapHeadOfAccountPage", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  // UX-016: the shared `parseErrorMessage` helper used to build the message
  // from the backend's own `message`/`error` field, or (when the body wasn't
  // JSON) the RAW response text verbatim, falling back to a literal
  // `Request failed (${res.status})` -- the same class of leak
  // useFormError/toHumanError closes fleet-wide (UX-003). This suite proves
  // all three independent flows on this page (load, create, map) are fixed.
  it("shows a clerk-safe message when the accounts load fails, never the raw status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));

    render(<MapHeadOfAccountPage />);

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't load/i));
    expect(alert.textContent).not.toMatch(/\b503\b/);
    expect(alert.textContent).not.toMatch(/failed to load/i);
  });

  // Regression: loadAccounts' fetch() (and its `if (!res.ok)` branch) had
  // been moved outside the try block during the UX-016 raw-status-leak fix.
  // loadAccounts is invoked as `void loadAccounts()` from the mount effect,
  // so a REJECTED fetch promise (offline, DNS failure, CORS -- as opposed to
  // a resolved non-2xx Response) escaped as an unhandled rejection instead of
  // being caught and routed through fromException. Proves the fetch (and its
  // ok-check) are back inside the try, same as every other file in this PR.
  it("shows a clerk-safe message when the initial accounts fetch itself rejects (network failure), never hangs or crashes", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<MapHeadOfAccountPage />);

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/check your internet connection/i));
    expect(alert.textContent).not.toMatch(/TypeError/);
    expect(alert.textContent).not.toMatch(/Failed to fetch/);
  });

  it("shows a clerk-safe message when creating a head of account fails, never the raw backend text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).includes("/finance/accounts") && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
      }
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ message: "duplicate_code: 2110 already exists" }), { status: 409 });
      }
      return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
    });

    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2110 · Sundry Creditors").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "2111" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test Head" } });
    fireEvent.click(screen.getByRole("button", { name: /create head/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/This head of account was changed by someone else\. Refresh to see the latest version, then try again\./));
    expect(alert.textContent).not.toMatch(/duplicate_code/i);
    expect(alert.textContent).not.toMatch(/\b409\b/);
  });

  it("shows a clerk-safe message when mapping a HoA code fails, never the raw status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/finance/accounts") && !String(url).includes("/hoa")) {
        return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });

    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2110 · Sundry Creditors").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText("Head of account"), { target: { value: "acc-1" } });
    fireEvent.change(screen.getByLabelText("PFMS HoA code"), { target: { value: "123456789012345678" } });
    fireEvent.click(screen.getByRole("button", { name: /save hoa code/i }));
    // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-01: saving now goes through a confirm dialog with a reason.
    fireEvent.change(await screen.findByLabelText("Reason for changing PFMS HoA code"), { target: { value: "Aligning with PFMS mapping" } });
    fireEvent.click(screen.getByRole("button", { name: "Change HoA code" }));

    // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-03: a failed save is announced as an alert.
    const banner = (await screen.findByText(/couldn't save/i)).closest("[role='alert']");
    expect(banner).not.toBeNull();
    expect(banner!.textContent).not.toMatch(/\b500\b/);
  });

  // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-01
  it("shows the head's current HoA code and sends the old->new change with a reason only after confirmation", async () => {
    const OLD = "210100101010101010";
    const NEW = "123456789012345678";
    const calls: { url: string; method?: string; body?: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body as string | undefined });
      if (init?.method === "PATCH") return new Response(JSON.stringify({ status: "updated" }), { status: 200 });
      return new Response(JSON.stringify({ data: [{ id: "acc-1", code: "2110", name: "Sundry Creditors", level: 0, hoaCode: OLD }] }), { status: 200 });
    });

    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2110 · Sundry Creditors").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Head of account"), { target: { value: "acc-1" } });
    expect(screen.getByText(OLD)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PFMS HoA code"), { target: { value: NEW } });
    fireEvent.click(screen.getByRole("button", { name: /save hoa code/i }));

    // Nothing is sent until the dialog is confirmed with a reason.
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    const confirm = await screen.findByRole("button", { name: "Change HoA code" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for changing PFMS HoA code"), { target: { value: "Aligning with PFMS mapping" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(JSON.parse(patch.body!)).toEqual({ hoaCode: NEW, reason: "Aligning with PFMS mapping" });
  });

  // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-01 (second approver)
  it("a 202 from the server is announced as submitted-for-approval, not as saved", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.method === "PATCH") return new Response(JSON.stringify({ status: "pending_approval", requestId: "r1" }), { status: 202 });
      return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
    });
    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2110 · Sundry Creditors").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Head of account"), { target: { value: "acc-1" } });
    fireEvent.change(screen.getByLabelText("PFMS HoA code"), { target: { value: "123456789012345678" } });
    fireEvent.click(screen.getByRole("button", { name: /save hoa code/i }));
    // the dialog warns that a different finance administrator must approve
    expect(await screen.findByText(/different finance administrator approves it/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason for changing PFMS HoA code"), { target: { value: "Aligning with PFMS mapping" } });
    fireEvent.click(screen.getByRole("button", { name: "Change HoA code" }));
    const status = await screen.findByText(/takes effect when a different finance administrator approves it/i);
    expect(status.closest("[role='status']")).not.toBeNull();
    expect(screen.queryByText("Head of Account code saved.")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-02
  it("requires a parent head for a minor head and sends parentId", async () => {
    const posts: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        posts.push(init.body as string);
        return new Response(JSON.stringify({ id: "new" }), { status: 201 });
      }
      return new Response(JSON.stringify({ data: [
        { id: "maj-1", code: "2000", name: "Liabilities", level: 0 },
        { id: "min-1", code: "2100", name: "Creditors", level: 1 },
      ] }), { status: 200 });
    });

    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2000 · Liabilities").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "2101" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Trade Creditors" } });
    // Major level: no parent field.
    expect(screen.queryByLabelText("Parent head")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "1" } });
    const parent = screen.getByLabelText("Parent head");
    // Only heads exactly one level up are offered as a parent.
    expect(screen.getAllByText("2000 · Liabilities").length).toBeGreaterThan(0);
    expect(parent.querySelectorAll("option").length).toBe(2); // placeholder + the one major head
    expect(screen.getByRole("button", { name: /create head/i })).toBeDisabled();

    fireEvent.change(parent, { target: { value: "maj-1" } });
    fireEvent.click(screen.getByRole("button", { name: /create head/i }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(JSON.parse(posts[0]!)).toMatchObject({ code: "2101", level: 1, parentId: "maj-1" });
  });

  // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-03
  it("a successful map save is announced as a status, not an alert", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.method === "PATCH") return new Response(JSON.stringify({ status: "updated" }), { status: 200 });
      return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
    });
    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2110 · Sundry Creditors").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Head of account"), { target: { value: "acc-1" } });
    fireEvent.change(screen.getByLabelText("PFMS HoA code"), { target: { value: "123456789012345678" } });
    fireEvent.click(screen.getByRole("button", { name: /save hoa code/i }));
    fireEvent.change(await screen.findByLabelText("Reason for changing PFMS HoA code"), { target: { value: "Aligning with PFMS mapping" } });
    fireEvent.click(screen.getByRole("button", { name: "Change HoA code" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-05
  it("a failed load offers Retry, disables the head picker and Save, and Retry recovers", async () => {
    let healthy = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      healthy ? new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 }) : new Response("", { status: 500 }));
    render(<MapHeadOfAccountPage />);
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't load/i));
    expect(screen.getByLabelText("Head of account")).toBeDisabled();
    expect(screen.getByRole("button", { name: /save hoa code/i })).toBeDisabled();

    healthy = true;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Head of account")).not.toBeDisabled();
    expect(screen.getAllByText("2110 · Sundry Creditors").length).toBeGreaterThan(0);
  });

  // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-04
  it("says the list is capped and finds a head beyond the cap via server search", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      urls.push(String(url));
      if (String(url).includes("q=450")) {
        return new Response(JSON.stringify({ data: [{ id: "h450", code: "450", name: "Deep Head", level: 0 }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: ACCOUNTS, pagination: { hasMore: true, pageSize: 200 } }), { status: 200 });
    });
    render(<MapHeadOfAccountPage />);
    expect(await screen.findByText(/Showing the first 200 heads/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find a head by code or name"), { target: { value: "450" } });
    await waitFor(() => expect(screen.getAllByText("450 · Deep Head").length).toBeGreaterThan(0));
    expect(urls.some((u) => u.includes("/finance/accounts?q=450"))).toBe(true);
  });

  // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-06
  it("the title expands the LMMHA acronym through a Term tooltip", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 }));
    render(<MapHeadOfAccountPage />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("LMMHA");
    expect(heading.querySelector("button, [role='tooltip'], [aria-describedby], abbr, [tabindex]")).not.toBeNull();
    await waitFor(() => expect(screen.getAllByText("2110 · Sundry Creditors").length).toBeGreaterThan(0));
  });
});

// GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-02: the new head names its whole path, and any parent is reachable.
describe("MapHeadOfAccountPage parent head -- path and search", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  const MAJOR = { id: "maj-1", code: "2000", name: "Liabilities", level: 0, parentId: null };
  const MINOR = { id: "min-1", code: "2100", name: "Creditors", level: 1, parentId: "maj-1" };

  function mockChart(rows: unknown[], extra?: (url: string) => Response | Error | null) {
    const posts: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (init?.method === "POST") { posts.push(init.body as string); return new Response(JSON.stringify({ id: "new" }), { status: 202 }); }
      const special = extra?.(String(url)) ?? null;
      if (special instanceof Error) throw special;
      return special ?? new Response(JSON.stringify({ data: rows }), { status: 200 });
    });
    return posts;
  }
  async function fill(codeValue: string, nameValue: string, levelValue: string, parentValue?: string) {
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: codeValue } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: nameValue } });
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: levelValue } });
    if (parentValue) fireEvent.change(screen.getByLabelText("Parent head"), { target: { value: parentValue } });
    fireEvent.click(screen.getByRole("button", { name: /create head/i }));
  }

  it("a sub-minor head's success message names the path Major > Minor > Sub-minor", async () => {
    mockChart([MAJOR, MINOR]);
    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2000 · Liabilities").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "2" } });
    await fill("2101", "Trade Creditors", "2", "min-1");
    expect(await screen.findByText(
      'Head of account "2101" created. It sits at: Major head 2000 (Liabilities) › Minor head 2100 (Creditors) › Sub-minor head 2101 (Trade Creditors).',
    )).toBeInTheDocument();
  });

  it("a minor head's message names Major > Minor; a major head says it is a major head", async () => {
    const posts = mockChart([MAJOR]);
    const { unmount } = render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2000 · Liabilities").length).toBeGreaterThan(0));
    await fill("2100", "Creditors", "1", "maj-1");
    expect(await screen.findByText('Head of account "2100" created. It sits at: Major head 2000 (Liabilities) › Minor head 2100 (Creditors).')).toBeInTheDocument();
    expect(JSON.parse(posts[0]!)).toMatchObject({ level: 1, parentId: "maj-1" });
    unmount();

    mockChart([]);
    render(<MapHeadOfAccountPage />);
    await fill("3000", "Assets", "0");
    expect(await screen.findByText('Head of account "3000" created as a major head.')).toBeInTheDocument();
  });

  it("an ancestor that is not loaded is shown as an ellipsis, never invented", async () => {
    // the minor head's own parent is not among the loaded heads
    mockChart([{ ...MINOR, parentId: "gone" }]);
    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2100 · Creditors").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "2" } });
    await fill("2101", "Trade", "2", "min-1");
    expect(await screen.findByText('Head of account "2101" created. It sits at: … › Minor head 2100 (Creditors) › Sub-minor head 2101 (Trade).')).toBeInTheDocument();
  });

  it("a parent beyond the loaded page is found by search and sent as parentId", async () => {
    const urls: string[] = [];
    const posts = mockChart([MAJOR], (url) => {
      urls.push(url);
      if (url.includes("q=9999")) return new Response(JSON.stringify({ data: [{ id: "maj-far", code: "9999", name: "Remote Major", level: 0, parentId: null }] }), { status: 200 });
      return null;
    });
    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2000 · Liabilities").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Find a parent head by code or name"), { target: { value: "9999" } });
    await waitFor(() => expect(screen.getAllByText("9999 · Remote Major").length).toBeGreaterThan(0));
    expect(urls.some((u) => u.includes("/finance/accounts?q=9999&limit=50"))).toBe(true);
    await fill("9999-01", "Far Minor", "1", "maj-far");
    await waitFor(() => expect(posts.length).toBe(1));
    expect(JSON.parse(posts[0]!)).toMatchObject({ level: 1, parentId: "maj-far" });
    expect(await screen.findByText(/Major head 9999 \(Remote Major\) › Minor head 9999-01 \(Far Minor\)/)).toBeInTheDocument();
  });

  it("the chosen parent stays selectable after a later search no longer returns it", async () => {
    mockChart([MAJOR], (url) => (url.includes("q=zzz") ? new Response(JSON.stringify({ data: [] }), { status: 200 }) : null));
    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2000 · Liabilities").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Parent head"), { target: { value: "maj-1" } });
    fireEvent.change(screen.getByLabelText("Find a parent head by code or name"), { target: { value: "zzz" } });
    await screen.findByText("No head at the right level matches that search.");
    expect((screen.getByLabelText("Parent head") as HTMLSelectElement).value).toBe("maj-1");
    // a search that succeeded and found nothing is "no match", never a failure
    expect(screen.queryByText(/Could not search the heads/)).not.toBeInTheDocument();
  });

  // A FAILED search is not an empty result: it must not read as "no match" (empty vs error).
  it.each([
    ["a non-2xx answer", () => new Response("", { status: 503 })],
    ["a network failure", () => new TypeError("Failed to fetch")],
  ])("a parent search that fails by %s says it could not search, not that nothing matches", async (_label, failure) => {
    mockChart([MAJOR], (url) => (url.includes("q=boom") ? failure() : url.includes("q=2000") ? new Response(JSON.stringify({ data: [MAJOR] }), { status: 200 }) : null));
    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2000 · Liabilities").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Find a parent head by code or name"), { target: { value: "boom" } });

    const alert = await screen.findByText("Could not search the heads. Check your connection and try again.");
    expect(alert).toHaveAttribute("role", "alert");
    expect(screen.queryByText("No head at the right level matches that search.")).not.toBeInTheDocument();
    expect(screen.queryByText(/\b503\b|TypeError|Failed to fetch/)).not.toBeInTheDocument();
    // the heads already loaded stay choosable, and the failure clears on the next search that works
    expect(screen.getAllByText("2000 · Liabilities").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Find a parent head by code or name"), { target: { value: "2000" } });
    await waitFor(() => expect(screen.queryByText(/Could not search the heads/)).not.toBeInTheDocument());
  });

  it("the HoA map card's head search also separates a failed search from no match", async () => {
    mockChart([MAJOR], (url) => (url.includes("q=boom") ? new Response("", { status: 500 }) : url.includes("q=zzz") ? new Response(JSON.stringify({ data: [] }), { status: 200 }) : null));
    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2000 · Liabilities").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Find a head by code or name"), { target: { value: "boom" } });
    const alert = await screen.findByText("Could not search the heads. Check your connection and try again.");
    expect(alert).toHaveAttribute("role", "alert");
    expect(screen.queryByText("No head matches that search.")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Find a head by code or name"), { target: { value: "zzz" } });
    expect(await screen.findByText("No head matches that search.")).toBeInTheDocument();
    expect(screen.queryByText(/Could not search the heads/)).not.toBeInTheDocument();
  });

  it("a minor head with no parent still cannot be submitted", async () => {
    const posts = mockChart([MAJOR]);
    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2000 · Liabilities").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "2100" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Creditors" } });
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "1" } });
    expect(screen.getByRole("button", { name: /create head/i })).toBeDisabled();
    expect(posts).toHaveLength(0);
  });
});
