import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import { NewTsForm as NewTsPage } from "./NewTsForm";

const WORK_ID = "123e4567-e89b-12d3-a456-426614174000";
const AUTH_ID = globalThis.crypto.randomUUID();

function stubFetch(createResponse: Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/v1/works/proposals")) {
      return new Response(JSON.stringify({ data: [{ id: WORK_ID, workNumber: "WK/2026/001", status: "dao_finalized" }] }), { status: 200 });
    }
    // The tenant user directory ({id, displayName} only): the admin-gated /identity/users list is not used.
    if (url.includes("/v1/identity/users/directory")) {
      return new Response(JSON.stringify({ data: [{ id: AUTH_ID, displayName: "A. Officer" }] }), { status: 200 });
    }
    if (url.includes("/v1/works/approvals/ts") && (init?.method ?? "GET") === "POST") {
      return createResponse;
    }
    return new Response("{}", { status: 200 });
  });
}

async function fillValidForm() {
  fireEvent.focus(screen.getByLabelText("Work"));
  fireEvent.change(screen.getByLabelText("Work"), { target: { value: "WK" } });
  fireEvent.mouseDown(await screen.findByText("WK/2026/001"));

  fireEvent.focus(screen.getByLabelText("TS authority"));
  fireEvent.change(screen.getByLabelText("TS authority"), { target: { value: "Officer" } });
  fireEvent.mouseDown(await screen.findByText("A. Officer"));

  fireEvent.change(screen.getByLabelText(/TS Number/i), { target: { value: "TS/2026-27/001" } });
  fireEvent.change(screen.getByLabelText(/Sanction date/i), { target: { value: "2026-01-01" } });
  fireEvent.change(screen.getByLabelText(/Sanction amount/i), { target: { value: "100000" } });
}

describe("NewTsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the async create truthfully as 'submitted' (202 != done) and sends BigInt-exact paise", async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: "ts1", status: "accepted" }), { status: 202 }));
    render(<NewTsPage />);
    await fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(
        screen.getByText("Technical sanction submitted. It will appear in the register once processed."),
      ).toBeInTheDocument(),
    );
    const post = fetchSpy.mock.calls.find(([u, i]) => String(u).includes("/approvals/ts") && (i as RequestInit)?.method === "POST");
    expect(post).toBeTruthy();
    const body = JSON.parse((post![1] as RequestInit).body as string);
    expect(body.tsAmountMinor).toBe("10000000"); // ₹100000.00 -> paise
    expect(body.workId).toBe(WORK_ID);
  });

  it("offers SR Year as a dropdown of recent financial years, not free text", () => {
    stubFetch(new Response("{}", { status: 202 }));
    render(<NewTsPage />);
    const select = screen.getByLabelText(/SR Year/i) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    // Current + previous few FYs are offered (6 options + the placeholder).
    expect(select.querySelectorAll("option").length).toBeGreaterThanOrEqual(6);
  });

  it("has a Cancel action back to the register", () => {
    stubFetch(new Response("{}", { status: 202 }));
    render(<NewTsPage />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when the create fails", async () => {
    stubFetch(new Response("", { status: 500 }));
    render(<NewTsPage />);
    await fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("rejects an amount with more than two decimals before POSTing", async () => {
    const fetchSpy = stubFetch(new Response("{}", { status: 202 }));
    render(<NewTsPage />);
    await fillValidForm();
    fireEvent.change(screen.getByLabelText(/Sanction amount/i), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(/valid amount in rupees/i)).toBeInTheDocument();
    expect(fetchSpy.mock.calls.filter(([u, i]) => String(u).includes("/approvals/ts") && (i as RequestInit)?.method === "POST")).toHaveLength(0);
  });
});

const DRAFT_ID = "223e4567-e89b-12d3-a456-426614174111";

function stubWorks(rows: Array<Record<string, unknown>>, createResponse?: Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/v1/works/proposals")) return new Response(JSON.stringify({ data: rows }), { status: 200 });
    if (url.includes("/v1/identity/users/directory")) {
      return new Response(JSON.stringify({ data: [{ id: AUTH_ID, displayName: "A. Officer" }] }), { status: 200 });
    }
    if (url.includes("/v1/works/approvals/ts") && (init?.method ?? "GET") === "POST") {
      return createResponse ?? new Response(JSON.stringify({ id: "ts1", status: "accepted" }), { status: 202 });
    }
    return new Response("{}", { status: 200 });
  });
}
const posts = (spy: ReturnType<typeof stubWorks>) =>
  spy.mock.calls.filter(([u, i]) => String(u).includes("/approvals/ts") && (i as RequestInit)?.method === "POST");

async function pickAuthority() {
  fireEvent.focus(screen.getByLabelText("TS authority"));
  fireEvent.change(screen.getByLabelText("TS authority"), { target: { value: "Officer" } });
  fireEvent.mouseDown(await screen.findByText("A. Officer"));
}

describe("NewTsForm: GAP-WORKS-APPROVALS-TS-NEW-01 DAO-finalized precondition", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const BOTH = [
    { id: WORK_ID, workNumber: "WK/FINAL/001", status: "dao_finalized" },
    { id: DRAFT_ID, workNumber: "WK/DRAFT/002", status: "draft" },
  ];

  it("lists a work that is not DAO-finalized as a DISABLED option with the reason, instead of hiding it", async () => {
    stubWorks(BOTH);
    render(<NewTsPage />);
    fireEvent.focus(screen.getByLabelText("Work"));
    fireEvent.change(screen.getByLabelText("Work"), { target: { value: "WK" } });
    expect(await screen.findByText("WK/FINAL/001")).toBeInTheDocument();
    const draft = screen.getByRole("option", { name: /WK\/DRAFT\/002/ });
    expect(draft).toHaveAttribute("aria-disabled", "true");
    expect(draft).toHaveTextContent("Not DAO-finalized");
    expect(screen.getByRole("option", { name: /WK\/FINAL\/001/ })).not.toHaveAttribute("aria-disabled");
  });

  it("cannot pick the disabled work: mouse selection is ignored and the form stays unselected", async () => {
    stubWorks(BOTH);
    render(<NewTsPage />);
    fireEvent.focus(screen.getByLabelText("Work"));
    fireEvent.change(screen.getByLabelText("Work"), { target: { value: "WK" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /WK\/DRAFT\/002/ }));
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("searches on the server (query, a limit, and the eligible statuses ranked first), not in the first 200 rows", async () => {
    const spy = stubWorks(BOTH);
    render(<NewTsPage />);
    fireEvent.focus(screen.getByLabelText("Work"));
    fireEvent.change(screen.getByLabelText("Work"), { target: { value: "WK" } });
    await screen.findByText("WK/FINAL/001");
    const url = String(spy.mock.calls.find(([u]) => String(u).includes("/v1/works/proposals"))![0]);
    expect(url).toContain("q=WK");
    expect(url).toContain("limit=50");
    expect(decodeURIComponent(url)).toContain("prefer=dao_finalized,ts_eligible");
    expect(url).not.toContain("pageSize=200");
  });

  it("shows the 'could not load' alert, not 'No matches', when the works lookup fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 500 }));
    render(<NewTsPage />);
    fireEvent.focus(screen.getByLabelText("Work"));
    fireEvent.change(screen.getByLabelText("Work"), { target: { value: "WK" } });
    expect(await screen.findByText("Could not load the works. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  it("prefills the Work from initialWorkId", async () => {
    stubWorks([{ id: WORK_ID, workNumber: "WK/FINAL/001", status: "dao_finalized" }]);
    render(<NewTsPage initialWorkId={WORK_ID} />);
    expect(await screen.findByDisplayValue("WK/FINAL/001")).toBeInTheDocument();
  });

  it("the info banner follows the selected work: neutral, then 'can be entered' for a finalized work", async () => {
    stubWorks(BOTH);
    render(<NewTsPage />);
    expect(screen.getByRole("note")).toHaveTextContent(/requires the work proposal to be DAO-finalized/i);
    fireEvent.focus(screen.getByLabelText("Work"));
    fireEvent.change(screen.getByLabelText("Work"), { target: { value: "WK" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /WK\/FINAL\/001/ }));
    const banner = await screen.findByText("The selected work is DAO-finalized, so a technical sanction can be entered for it.");
    expect(banner).toHaveAttribute("role", "status");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("a work prefilled from ?workId= that is NOT DAO-finalized turns the banner into a warning and blocks Create", async () => {
    const spy = stubWorks([{ id: DRAFT_ID, workNumber: "WK/DRAFT/002", status: "draft" }]);
    render(<NewTsPage initialWorkId={DRAFT_ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The selected work is not DAO-finalized, so a technical sanction cannot be entered for it yet.");
    await pickAuthority();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);
    expect(posts(spy)).toHaveLength(0);
  });
});

describe("NewTsForm: GAP-WORKS-APPROVALS-TS-NEW-01 Create is disabled until a work and an authority are chosen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("is disabled with an explanation on a blank form, and a forced submit POSTs nothing", async () => {
    const spy = stubWorks([{ id: WORK_ID, workNumber: "WK/FINAL/001", status: "dao_finalized" }]);
    render(<NewTsPage />);
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();
    expect(screen.getByText("Choose a work and a TS authority to continue.")).toBeInTheDocument();
    expect(create).toHaveAttribute("aria-describedby", "ts-new-submit-hint");
    fireEvent.change(screen.getByLabelText(/TS Number/i), { target: { value: "TS/1" } });
    fireEvent.submit(create.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a work and a TS authority to continue.");
    expect(posts(spy)).toHaveLength(0);
  });

  it("stays disabled with only the work chosen, and enables once the authority is chosen too", async () => {
    stubWorks([{ id: WORK_ID, workNumber: "WK/FINAL/001", status: "dao_finalized" }]);
    render(<NewTsPage />);
    fireEvent.focus(screen.getByLabelText("Work"));
    fireEvent.change(screen.getByLabelText("Work"), { target: { value: "WK" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /WK\/FINAL\/001/ }));
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    await pickAuthority();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create" })).toBeEnabled());
    expect(screen.queryByText("Choose a work and a TS authority to continue.")).not.toBeInTheDocument();
  });

  it("the TS authority picker searches the tenant user directory (min 2 characters), not the admin-only users list", async () => {
    const spy = stubWorks([]);
    render(<NewTsPage />);
    fireEvent.focus(screen.getByLabelText("TS authority"));
    fireEvent.change(screen.getByLabelText("TS authority"), { target: { value: "O" } });
    await new Promise((r) => setTimeout(r, 400));
    expect(spy.mock.calls.some(([u]) => String(u).includes("/identity/users"))).toBe(false); // one character: no request
    fireEvent.change(screen.getByLabelText("TS authority"), { target: { value: "Of" } });
    await screen.findByText("A. Officer");
    const urls = spy.mock.calls.map(([u]) => String(u)).filter((u) => u.includes("/identity/users"));
    expect(urls).toEqual(["/api/proxy/v1/identity/users/directory?q=Of"]);
  });

  it("a valid form still POSTs the exact ids and paise", async () => {
    const spy = stubWorks([{ id: WORK_ID, workNumber: "WK/FINAL/001", status: "dao_finalized" }]);
    render(<NewTsPage />);
    fireEvent.focus(screen.getByLabelText("Work"));
    fireEvent.change(screen.getByLabelText("Work"), { target: { value: "WK" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /WK\/FINAL\/001/ }));
    await pickAuthority();
    fireEvent.change(screen.getByLabelText(/TS Number/i), { target: { value: "TS/2026-27/001" } });
    fireEvent.change(screen.getByLabelText(/Sanction date/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/Sanction amount/i), { target: { value: "2500.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(posts(spy)).toHaveLength(1));
    const body = JSON.parse((posts(spy)[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ workId: WORK_ID, tsAuthorityId: AUTH_ID, tsAmountMinor: "250050", tsDate: "2026-01-01" });
  });
});
