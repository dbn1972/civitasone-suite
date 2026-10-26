import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

// next/navigation is globally mocked in vitest.setup.ts

const identity = vi.hoisted(() => ({ roles: ["estab_officer"] as string[] }));
vi.mock("@/lib/auth/useSessionIdentity", () => ({
  useSessionIdentity: () => ({ loaded: true, userId: "u1", roles: identity.roles }),
}));
const divisions = vi.hoisted(() => ({
  value: { loaded: true, failed: false, forbidden: false, divisions: ["Admin", "Finance"] } as {
    loaded: boolean; failed: boolean; forbidden?: boolean; divisions: string[];
  },
}));
vi.mock("@/lib/estab/useEstabDivisions", () => ({ useEstabDivisions: () => divisions.value }));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

import DakRegistryPage from "./page";

const RECEIVED_ROW = {
  id: "d1", dakNo: "DAK/2026/001", fromAddress: "Home Ministry",
  subject: "Confidential memo", receivedAt: "2026-10-01", status: "received",
  fileId: null, fileRef: null, barcode: "B001", sourceSection: null,
};

describe("DAK-01: open-file requires classification dialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    identity.roles = ["estab_officer"];
    divisions.value = { loaded: true, failed: false, divisions: ["Admin", "Finance"] };
  });

  it("opens a dialog when 'Open file' is clicked, requiring dept + classification", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [RECEIVED_ROW] }));
    render(<DakRegistryPage />);
    const btn = await screen.findByRole("button", { name: "Open file" });
    fireEvent.click(btn);
    // The dialog title names the DAK; a department pick-list and classification select appear
    expect(await screen.findByText(/Open file from DAK DAK\/2026\/001/i)).toBeInTheDocument();
    const dept = screen.getByLabelText(/Department/i) as HTMLSelectElement;
    expect(dept.tagName).toBe("SELECT");
    const classSelect = screen.getByLabelText(/Classification/i) as HTMLSelectElement;
    // classification options include confidential and top_secret, not a default
    expect(classSelect.querySelector('option[value="confidential"]')).toBeTruthy();
    expect(classSelect.value).toBe(""); // forced choice, no default "public"
  });

  it("posts the chosen classification and dept, not hard-coded 'public'/'ADMIN'", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("open-file")) return Promise.resolve(jsonResponse({ id: "file-new" }));
      return Promise.resolve(jsonResponse({ data: [RECEIVED_ROW] }));
    });

    render(<DakRegistryPage />);
    const btn = await screen.findByRole("button", { name: "Open file" });
    fireEvent.click(btn);
    await screen.findByText(/Open file from DAK DAK\/2026\/001/i);

    fireEvent.change(screen.getByLabelText(/Department/i), { target: { value: "Finance" } });
    fireEvent.change(screen.getByLabelText(/Classification/i), { target: { value: "confidential" } });
    fireEvent.click(screen.getByRole("button", { name: /Open the file/i }));

    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes("open-file"));
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.classification).toBe("confidential");
      expect(body.dept).toBe("Finance");
    });
  });

  it("when the department list is unavailable (403 for this role), Department is a typed field and its value is posted", async () => {
    divisions.value = { loaded: true, failed: true, forbidden: true, divisions: [] };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes("open-file")) return Promise.resolve(jsonResponse({ id: "file-new" }));
      return Promise.resolve(jsonResponse({ data: [RECEIVED_ROW] }));
    });
    render(<DakRegistryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Open file" }));
    await screen.findByText(/Open file from DAK DAK\/2026\/001/i);
    const dept = screen.getByLabelText(/Department/i) as HTMLInputElement;
    expect(dept.tagName).toBe("INPUT");
    fireEvent.change(dept, { target: { value: "Legal" } });
    fireEvent.change(screen.getByLabelText(/Classification/i), { target: { value: "confidential" } });
    fireEvent.click(screen.getByRole("button", { name: /Open the file/i }));
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes("open-file"));
      expect(JSON.parse((call![1] as RequestInit).body as string).dept).toBe("Legal");
    });
  });

  it("GAP-ESTAB-FILES-NEW-03: the department is a pick-list of real departments, with no free-text input", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [RECEIVED_ROW] }));
    render(<DakRegistryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Open file" }));
    await screen.findByText(/Open file from DAK/i);
    const dept = screen.getByLabelText(/Department/i) as HTMLSelectElement;
    expect(Array.from(dept.options).map((o) => o.value)).toEqual(["", "Admin", "Finance"]);
    expect(screen.queryByPlaceholderText(/ADMIN/i)).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-FILES-NEW-03: when the department list failed to load (network/server), Department is a disabled select with an alert, never a typed field", async () => {
    divisions.value = { loaded: true, failed: true, forbidden: false, divisions: [] };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [RECEIVED_ROW] }));
    render(<DakRegistryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Open file" }));
    await screen.findByText(/Open file from DAK/i);
    const dept = screen.getByLabelText(/Department/i) as HTMLSelectElement;
    expect(dept.tagName).toBe("SELECT");
    expect(dept.disabled).toBe(true);
    const why = screen.getByText(/Departments could not be loaded/i);
    expect(why.getAttribute("role")).toBe("alert");
    fireEvent.change(screen.getByLabelText(/Classification/i), { target: { value: "confidential" } });
    fireEvent.click(screen.getByRole("button", { name: /Open the file/i }));
    expect(await screen.findByText("Select a department.")).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("open-file"))).toBe(false);
  });

  it("GAP-ESTAB-FILES-NEW-03: with no departments enrolled Department is an enabled typed field and says why", async () => {
    divisions.value = { loaded: true, failed: false, divisions: [] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [RECEIVED_ROW] }));
    render(<DakRegistryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Open file" }));
    await screen.findByText(/Open file from DAK/i);
    const dept = screen.getByLabelText(/Department/i) as HTMLInputElement;
    expect(dept.tagName).toBe("INPUT");
    expect(dept.disabled).toBe(false);
    expect(screen.getByRole("note").textContent).toMatch(/No department list is available/i);
  });

  it("GAP-ESTAB-DAK-01: an audit officer sees the register but no Open file button and no register form", async () => {
    identity.roles = ["audit_officer"];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [RECEIVED_ROW] }));
    render(<DakRegistryPage />);
    await screen.findByText("DAK/2026/001");
    expect(screen.queryByRole("button", { name: "Open file" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Register DAK" })).not.toBeInTheDocument();
  });

  it("a linked file with no file number reads 'View file', never an id fragment", async () => {
    const row = { ...RECEIVED_ROW, status: "file_opened", fileId: "3f9a1c2e-1111-4222-8333-444455556666", fileRef: null };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [row] }));
    render(<DakRegistryPage />);
    const link = await screen.findByRole("link", { name: "View file" });
    expect(link).toHaveAttribute("href", "/estab/files/3f9a1c2e-1111-4222-8333-444455556666");
    expect(document.body.textContent).not.toContain("3f9a1c2e");
  });
});

describe("DAK-02: clerk-safe errors", () => {
  beforeEach(() => { vi.restoreAllMocks(); identity.roles = ["estab_officer"]; });

  it("shows a human-readable error (not raw JSON) on a failed register", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // load
      .mockResolvedValueOnce(new Response('{"code":"VALIDATION_FAILED"}', { status: 400 })); // register

    render(<DakRegistryPage />);
    await waitFor(() => expect(screen.getByText("Register DAK")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^From/i), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "Test sub" } });
    fireEvent.click(screen.getByRole("button", { name: "Register DAK" }));

    await waitFor(() => {
      const alertRegion = screen.getAllByRole("alert").find((a) => a.textContent) as HTMLElement;
      expect(alertRegion.textContent).not.toMatch(/VALIDATION_FAILED/);
    });
  });
});

describe("DAK-03: register form fields and validation", () => {
  beforeEach(() => { vi.restoreAllMocks(); identity.roles = ["estab_officer"]; });

  it("renders Mode, Received date, Urgency, Addressee and Source section fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<DakRegistryPage />);
    await waitFor(() => expect(screen.getByLabelText(/Mode/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/Received date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Urgency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Addressee officer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Source section/i)).toBeInTheDocument();
  });

  it("Given a blank sender, When Register DAK is clicked, Then nothing is posted and a message names the field", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<DakRegistryPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Register DAK" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "Test sub" } });
    fireEvent.click(screen.getByRole("button", { name: "Register DAK" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => /sender/i.test(a.textContent ?? ""))).toBe(true));
    expect(fetchSpy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("Given a valid form, When submitted, Then it posts the chosen fields and the message says the number appears once processed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((...args: [RequestInfo | URL, RequestInit?]) => {
      if (args[1]?.method === "POST") return Promise.resolve(jsonResponse({ id: "x", status: "accepted" }, 202));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    render(<DakRegistryPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Register DAK" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^From/i), { target: { value: "Home Ministry" } });
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "Memo" } });
    fireEvent.change(screen.getByLabelText(/Mode/i), { target: { value: "hand" } });
    fireEvent.change(screen.getByLabelText(/Source section/i), { target: { value: "Accounts" } });
    fireEvent.click(screen.getByRole("button", { name: "Register DAK" }));
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
        fromAddress: "Home Ministry", subject: "Memo", mode: "hand", sourceSection: "Accounts",
      });
    });
    expect(await screen.findByText(/barcode appear in the register/i)).toBeInTheDocument();
  });
});

describe("DAK-04: the register is searched and paged on the server", () => {
  beforeEach(() => { vi.restoreAllMocks(); identity.roles = ["estab_officer"]; });

  const rowsOf = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => ({ ...RECEIVED_ROW, id: `d${from + i}`, dakNo: `DAK/2026/${from + i}` }));

  it("shows how many of the matching entries are on screen and loads the next page with the right offset", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://x");
      const offset = Number(url.searchParams.get("offset"));
      return Promise.resolve(jsonResponse({ data: offset === 0 ? rowsOf(50) : rowsOf(50, 50), pagination: { total: 250 } }));
    });
    render(<DakRegistryPage />);
    expect(await screen.findByText("Showing 50 of 250")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Showing 100 of 250")).toBeInTheDocument();
    const offsets = fetchSpy.mock.calls.map((c) => new URL(String(c[0]), "http://x").searchParams.get("offset"));
    expect(offsets).toEqual(["0", "50"]);
  });

  it("Given 250 records, When an old barcode is searched, Then the term is sent to the server and its match is listed", async () => {
    const old = { ...RECEIVED_ROW, id: "old", dakNo: "DAK/2024/777", barcode: "B-OLD-777" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const q = new URL(String(input), "http://x").searchParams.get("q");
      return Promise.resolve(jsonResponse(q === "B-OLD-777" ? { data: [old], pagination: { total: 1 } } : { data: rowsOf(50), pagination: { total: 250 } }));
    });
    render(<DakRegistryPage />);
    await screen.findByText("Showing 50 of 250");
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "B-OLD-777" } });
    expect(await screen.findByText("DAK/2024/777")).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some((c) => new URL(String(c[0]), "http://x").searchParams.get("q") === "B-OLD-777")).toBe(true);
  });

  it("does not show a count or Load more for a single short page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [RECEIVED_ROW], pagination: { total: 1 } }));
    render(<DakRegistryPage />);
    await screen.findByText("DAK/2026/001");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("Given a search with no match, Then it says nothing matched rather than that no DAK exists", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const q = new URL(String(input), "http://x").searchParams.get("q");
      return Promise.resolve(jsonResponse(q ? { data: [], pagination: { total: 0 } } : { data: [RECEIVED_ROW], pagination: { total: 1 } }));
    });
    render(<DakRegistryPage />);
    await screen.findByText("DAK/2026/001");
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "zzz" } });
    expect(await screen.findByText("No DAK matches your search")).toBeInTheDocument();
  });
});

describe("DAK-05: StatusPill humanisation + success msg with number", () => {
  beforeEach(() => { vi.restoreAllMocks(); identity.roles = ["estab_officer"]; });

  it("uses StatusPill with no explicit label override (humanises internally)", async () => {
    const row = { ...RECEIVED_ROW, status: "file_opened" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [row] }));
    render(<DakRegistryPage />);
    // StatusPill with status="file_opened" should internally humanize to "File Opened"
    await screen.findByText("DAK/2026/001");
    // The status cell should NOT show raw "file_opened"
    expect(screen.queryByText("file_opened")).not.toBeInTheDocument();
  });

  it("shows null sourceSection as '—' not 'manual'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [RECEIVED_ROW] }));
    render(<DakRegistryPage />);
    await screen.findByText("DAK/2026/001");
    // Source column for null sourceSection should be "—"
    expect(screen.queryByText("manual")).not.toBeInTheDocument();
  });
});

describe("DAK page i18n", () => {
  beforeEach(() => { vi.restoreAllMocks(); identity.roles = ["estab_officer"]; });

  it("renders the register heading and form labels in Hindi with the same fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [RECEIVED_ROW], pagination: { total: 1 } }));
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <DakRegistryPage />
      </NextIntlClientProvider>,
    );
    await screen.findByText("DAK/2026/001");
    const hi = hiMessages.estabW2;
    expect(screen.getByRole("heading", { name: hi.dakRegisterHeading })).toBeInTheDocument();
    expect(screen.getByLabelText(hi.dakSearchLabel)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: hi.dakRegisterBtn })).toBeInTheDocument();
    expect(hi.dakRegisterHeading).not.toBe(enMessages.estabW2.dakRegisterHeading);
  });
});

describe("DAK-03: the allocated DAK number and barcode reach the success message", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    identity.roles = ["estab_officer"];
  });
  afterEach(() => vi.useRealTimers());

  const NEW_ROW = {
    id: "new-1", dakNo: "DAK/2026/0042", fromAddress: "Home Ministry", subject: "Fresh memo",
    receivedAt: "2026-10-21", status: "received", fileId: null, fileRef: null, barcode: "DAK-DAK-2026-0042", sourceSection: null,
  };

  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  /** The service: the register is empty until the registration is processed, then holds the new row. */
  function installService(opts: { appearsOnPoll: number | null; row?: Record<string, unknown> }) {
    let polls = 0;
    const lookups: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://x");
      if (init?.method === "POST") return Promise.resolve(jsonResponse({ id: "new-1", status: "accepted" }, 202));
      const q = url.searchParams.get("q");
      if (q) {
        // a lookup of the new row by its subject or number; like the service, refuse a term over 100 characters
        polls += 1;
        lookups.push(q);
        if (q.length > 100) return Promise.resolve(jsonResponse({ error: { code: "VALIDATION" } }, 400));
        const present = opts.appearsOnPoll !== null && polls >= opts.appearsOnPoll;
        return Promise.resolve(jsonResponse({ data: present ? [opts.row ?? NEW_ROW] : [], pagination: { total: present ? 1 : 0 } }));
      }
      return Promise.resolve(jsonResponse({ data: [], pagination: { total: 0 } }));
    });
    return { fetchSpy, polls: () => polls, lookups };
  }

  async function register(dakNo = "", subject = "Fresh memo") {
    render(<DakRegistryPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Register DAK" })).toBeInTheDocument());
    if (dakNo) fireEvent.change(screen.getByLabelText(/^DAK number/i), { target: { value: dakNo } });
    fireEvent.change(screen.getByLabelText(/^From/i), { target: { value: "Home Ministry" } });
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: subject } });
    fireEvent.click(screen.getByRole("button", { name: "Register DAK" }));
    await screen.findByText(/registered\./);
  }

  it("Given an auto-numbered DAK, When the row appears on the 2nd lookup, Then the message names the allocated number and barcode", async () => {
    const h = installService({ appearsOnPoll: 2 });
    await register();
    expect(screen.getByText(/Its DAK number and barcode appear in the register below once it is processed/)).toBeInTheDocument();
    await tick(1000); // lookup 1: not processed yet
    expect(screen.queryByText(/Barcode DAK-DAK-2026-0042/)).not.toBeInTheDocument();
    await tick(1000); // lookup 2: processed
    expect(await screen.findByText("DAK DAK/2026/0042 registered. Barcode DAK-DAK-2026-0042.")).toBeInTheDocument();
    // the lookup is by the subject, whatever the received date, and it stops once the row is found
    expect(h.lookups).toEqual(["Fresh memo", "Fresh memo"]);
    await tick(10_000);
    expect(h.polls()).toBe(2);
  });

  it("Given a typed DAK number, the message names it straight away and then adds the barcode", async () => {
    installService({ appearsOnPoll: 1, row: { ...NEW_ROW, dakNo: "D-77", barcode: "DAK-D-77" } });
    await register("D-77");
    expect(screen.getByText(/DAK D-77 registered\. Its barcode appears in the register below/)).toBeInTheDocument();
    await tick(1000);
    expect(await screen.findByText("DAK D-77 registered. Barcode DAK-D-77.")).toBeInTheDocument();
  });

  it("Given a typed DAK number, Then the lookup is by that number, not by the subject", async () => {
    const h = installService({ appearsOnPoll: 1, row: { ...NEW_ROW, dakNo: "D-77", barcode: "DAK-D-77" } });
    await register("D-77");
    await tick(1000);
    await screen.findByText("DAK D-77 registered. Barcode DAK-D-77.");
    expect(h.lookups).toEqual(["D-77"]);
  });

  it("Given a subject over 100 characters, When the row appears, Then the lookup term is cut to 100 characters and the barcode still shows", async () => {
    const longSubject = "Request for the sanction of an advance for the annual conference of the department, with the budget head and the proposed venue, dates and delegates listed in the enclosed note";
    expect(longSubject.length).toBeGreaterThan(100);
    const h = installService({ appearsOnPoll: 2, row: { ...NEW_ROW, subject: longSubject } });
    await register("", longSubject);
    await tick(1000); // lookup 1: not processed yet
    await tick(1000); // lookup 2: processed
    expect(await screen.findByText("DAK DAK/2026/0042 registered. Barcode DAK-DAK-2026-0042.")).toBeInTheDocument();
    // the first 100 characters, trimmed (the service trims the term too)
    const term = longSubject.slice(0, 100).trim();
    expect(h.lookups).toEqual([term, term]);
    expect(h.lookups.every((q) => q.length <= 100)).toBe(true);
  });

  it("Given the row never appears, Then the message stays the honest 'appears once processed' text and the lookups stop", async () => {
    const h = installService({ appearsOnPoll: null });
    await register();
    for (let i = 0; i < 5; i += 1) await tick(1000);
    expect(screen.getByText(/Its DAK number and barcode appear in the register below once it is processed/)).toBeInTheDocument();
    expect(h.polls()).toBe(5);
    await tick(10_000);
    expect(h.polls()).toBe(5);
  });

  it("stops looking when the page is closed", async () => {
    const h = installService({ appearsOnPoll: null });
    render(<DakRegistryPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Register DAK" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^From/i), { target: { value: "Home Ministry" } });
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "Fresh memo" } });
    fireEvent.click(screen.getByRole("button", { name: "Register DAK" }));
    await screen.findByText(/registered\./);
    await tick(1000);
    const seen = h.polls();
    cleanup();
    await tick(10_000);
    expect(h.polls()).toBe(seen);
  });
});

describe("DAK-05: status label and success message (GAP-ESTAB-DAK-05)", () => {
  beforeEach(() => { vi.restoreAllMocks(); identity.roles = ["estab_officer"]; });

  it("shows status file_opened as 'File Opened' (humanised), never the raw value", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [{ ...RECEIVED_ROW, status: "file_opened" }] }));
    render(<DakRegistryPage />);
    await screen.findByText("DAK/2026/001");
    expect(screen.getByText("File Opened")).toBeInTheDocument();
    expect(screen.queryByText("file_opened")).not.toBeInTheDocument();
    expect(screen.queryByText("file opened")).not.toBeInTheDocument();
  });

  it("shows an empty source section as an em dash and a set one as a readable label", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [
      { ...RECEIVED_ROW, id: "a", dakNo: "DAK/A", sourceSection: null },
      { ...RECEIVED_ROW, id: "b", dakNo: "DAK/B", sourceSection: "accounts_branch" },
    ] }));
    render(<DakRegistryPage />);
    await screen.findByText("DAK/A");
    expect(screen.getByText("Accounts Branch")).toBeInTheDocument();
    expect(screen.queryByText("manual")).not.toBeInTheDocument();
  });

  it("the success message names the DAK number the clerk typed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((...args: [RequestInfo | URL, RequestInit?]) =>
      Promise.resolve(args[1]?.method === "POST" ? jsonResponse({ id: "z", status: "accepted" }, 202) : jsonResponse({ data: [] })));
    render(<DakRegistryPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Register DAK" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^DAK number/i), { target: { value: "DAK/2026/555" } });
    fireEvent.change(screen.getByLabelText(/^From/i), { target: { value: "Ministry" } });
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "Memo" } });
    fireEvent.click(screen.getByRole("button", { name: "Register DAK" }));
    expect(await screen.findByText(/DAK DAK\/2026\/555 registered\./)).toBeInTheDocument();
  });
});

// CLOS3-S1-10: the register form had no in-flight guard, so a double submit queued two inward registrations.
describe("DAK-03: Register DAK is guarded against double submit (CLOS3-S1-10)", () => {
  beforeEach(() => { vi.restoreAllMocks(); identity.roles = ["estab_officer"]; });
  afterEach(() => cleanup());

  const posts = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");

  async function fillValidForm() {
    render(<DakRegistryPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Register DAK" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^From/i), { target: { value: "Home Ministry" } });
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "Memo" } });
    return screen.getByRole("button", { name: "Register DAK" }).closest("form") as HTMLFormElement;
  }

  it("sends a single POST for two submits before the first resolves, then clears the form and re-enables", async () => {
    let resolvePost: (r: Response) => void = () => {};
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Promise<Response>((res) => { resolvePost = res; })
        : Promise.resolve(jsonResponse({ data: [], pagination: { total: 0 } })));
    const form = await fillValidForm();

    fireEvent.submit(form);
    fireEvent.submit(form);

    const btn = screen.getByRole("button", { name: "Register DAK" });
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(posts(spy)).toHaveLength(1);

    await act(async () => { resolvePost(jsonResponse({ id: "x", status: "accepted" }, 202)); });
    await waitFor(() => expect((screen.getByLabelText(/^From/i) as HTMLInputElement).value).toBe(""));
    await waitFor(() => expect(screen.getByRole("button", { name: "Register DAK" })).toBeEnabled());
    expect(posts(spy)).toHaveLength(1);
  });

  it("re-enables after a failed POST and allows a second attempt", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? Promise.reject(new Error("network"))
        : Promise.resolve(jsonResponse({ data: [], pagination: { total: 0 } })));
    const form = await fillValidForm();

    fireEvent.submit(form);
    await waitFor(() => expect(posts(spy)).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Register DAK" })).toBeEnabled());

    fireEvent.submit(form);
    await waitFor(() => expect(posts(spy)).toHaveLength(2));
  });
});
