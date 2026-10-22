import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(jsonResponse({ id: "x", status: "accepted" }, 202));
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
