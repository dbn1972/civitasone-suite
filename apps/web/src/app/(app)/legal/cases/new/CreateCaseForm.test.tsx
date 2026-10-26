import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { CreateCaseForm } from "./CreateCaseForm";

const CASE_TYPES = [
  { id: "11111111-1111-4111-8111-111111111111", code: "criminal", name: "Criminal Case" },
  { id: "22222222-2222-4222-8222-222222222222", code: "writ", name: "Writ Petition" },
];
const COURTS = [
  { code: "sc_india", name: "Supreme Court of India", kind: "supreme" },
  { code: "hc_delhi", name: "High Court of Delhi", kind: "high_court" },
  { code: "ngt", name: "National Green Tribunal", kind: "tribunal" },
];
const DEPTS = [
  { id: "99999999-aaaa-4000-8000-000000000001", name: "Revenue Department" },
  { id: "99999999-aaaa-4000-8000-000000000002", name: "Public Works Department" },
];

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl as unknown as typeof fetch) as unknown as typeof fetch;
}

/** Reference-data + case-type responses shared by every test; `rest` handles the case endpoints. */
function refData(url: string, caseTypes: unknown[] = CASE_TYPES): Response | null {
  if (url.includes("/v1/legal/case-types")) return new Response(JSON.stringify({ items: caseTypes }), { status: 200 });
  if (url.includes("/v1/legal/courts")) return new Response(JSON.stringify({ items: COURTS }), { status: 200 });
  if (url.includes("/v1/legal/departments")) return new Response(JSON.stringify({ items: DEPTS }), { status: 200 });
  return null;
}

async function ready() {
  await waitFor(() => expect(screen.getByRole("option", { name: "High Court of Delhi" })).toBeInTheDocument());
}

/** Fill the mandatory fields with a master court + department (the common path). */
function fillMaster(caseNo = "WP/1/2026") {
  fireEvent.change(screen.getByLabelText("Case number *"), { target: { value: caseNo } });
  fireEvent.change(screen.getByLabelText("Court / Forum *"), { target: { value: "hc_delhi" } });
  fireEvent.change(screen.getByLabelText("Case title *"), { target: { value: "A vs. B" } });
  fireEvent.change(screen.getByLabelText("Department *"), { target: { value: DEPTS[0]!.id } });
}

describe("CreateCaseForm — case-type master (GAP-LEGAL-CASES-NEW-01)", () => {
  beforeEach(() => { pushMock.mockReset(); refreshMock.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("loads case types on mount and sends the chosen caseTypeId on submit", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    mockFetch(async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      const r = refData(url);
      if (r) return r;
      if (url.includes("/v1/legal/cases/case-1")) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ id: "case-1", status: "accepted" }), { status: 202 });
    });

    render(<CreateCaseForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Criminal Case" })).toBeInTheDocument());
    await ready();

    fillMaster("CR/99/2026");
    fireEvent.change(screen.getByLabelText("Case type"), { target: { value: "11111111-1111-4111-8111-111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));

    // GAP-LEGAL-CASES-NEW-03: lands on the new case, not the list.
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/legal/cases/case-1"));
    const post = calls.find((c) => c.url.endsWith("/v1/legal/cases") && c.body);
    expect(post?.body).toMatchObject({ caseTypeId: "11111111-1111-4111-8111-111111111111", caseNo: "CR/99/2026" });
  });

  it("shows an honest hint and disables the select when the master is empty", async () => {
    mockFetch(async (url) => refData(url, []) ?? new Response(JSON.stringify({ id: "case-1", status: "accepted" }), { status: 202 }));
    render(<CreateCaseForm />);
    await waitFor(() => expect(screen.getByText(/No case types are configured yet/)).toBeInTheDocument());
    expect(screen.getByLabelText("Case type")).toBeDisabled();
  });

  it("omits caseTypeId when none is chosen (falls back to caseNo heuristic server-side)", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    mockFetch(async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return refData(url) ?? new Response(JSON.stringify({ id: "case-2", status: "accepted" }), { status: 202 });
    });
    render(<CreateCaseForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Writ Petition" })).toBeInTheDocument());
    await ready();
    fillMaster();
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const post = calls.find((c) => c.url.endsWith("/v1/legal/cases") && c.body);
    expect(post?.body).not.toHaveProperty("caseTypeId");
  });
});

describe("CreateCaseForm — court master, filing date, department (GAP-LEGAL-CASES-NEW-02, decision #10)", () => {
  beforeEach(() => { pushMock.mockReset(); refreshMock.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("offers the court master grouped by kind, plus an Other option", async () => {
    mockFetch(async (url) => refData(url) ?? new Response("{}", { status: 200 }));
    render(<CreateCaseForm />);
    await ready();
    expect(screen.getByRole("option", { name: "Supreme Court of India" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "National Green Tribunal" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Other (not in the list)" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "High Courts" })).toBeInTheDocument();
  });

  it("sends courtCode, filingDate and departmentId for a master court (no free-text court)", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    mockFetch(async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return refData(url) ?? new Response(JSON.stringify({ id: "case-3", status: "accepted" }), { status: 202 });
    });
    render(<CreateCaseForm />);
    await ready();
    fillMaster();
    fireEvent.change(screen.getByLabelText("Filing date *"), { target: { value: "2026-03-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const body = calls.find((c) => c.url.endsWith("/v1/legal/cases") && c.body)!.body!;
    expect(body).toMatchObject({ courtCode: "hc_delhi", filingDate: "2026-03-15", departmentId: DEPTS[0]!.id });
    expect(body).not.toHaveProperty("court");
  });

  it("Other reveals a free-text name, says it will be unverified, and sends it as the court", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    mockFetch(async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return refData(url) ?? new Response(JSON.stringify({ id: "case-4", status: "accepted" }), { status: 202 });
    });
    render(<CreateCaseForm />);
    await ready();
    fireEvent.change(screen.getByLabelText("Case number *"), { target: { value: "OTH/1/2026" } });
    fireEvent.change(screen.getByLabelText("Case title *"), { target: { value: "A vs. B" } });
    fireEvent.change(screen.getByLabelText("Department *"), { target: { value: DEPTS[1]!.id } });
    fireEvent.change(screen.getByLabelText("Court / Forum *"), { target: { value: "other" } });
    expect(screen.getByText(/saved as typed and marked unverified/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Court / forum name *"), { target: { value: "Local Lok Adalat" } });
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const body = calls.find((c) => c.url.endsWith("/v1/legal/cases") && c.body)!.body!;
    expect(body).toMatchObject({ courtCode: "other", court: "Local Lok Adalat" });
  });

  it("does not submit without a court, a department or a valid filing date", async () => {
    const calls: string[] = [];
    mockFetch(async (url, init) => { calls.push(`${init?.method ?? "GET"} ${url}`); return refData(url) ?? new Response("{}", { status: 202 }); });
    render(<CreateCaseForm />);
    await ready();
    fireEvent.change(screen.getByLabelText("Case number *"), { target: { value: "X/1" } });
    fireEvent.change(screen.getByLabelText("Case title *"), { target: { value: "T" } });
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));
    expect(await screen.findByText("Case number, title and court are required.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Court / Forum *"), { target: { value: "hc_delhi" } });
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));
    expect(await screen.findByText("Select the department that owns this case.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Department *"), { target: { value: DEPTS[0]!.id } });
    fireEvent.change(screen.getByLabelText("Filing date *"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));
    expect(await screen.findByText("Enter the filing date. It cannot be in the future.")).toBeInTheDocument();
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("says so (not an empty list) when the court / department lists cannot be loaded", async () => {
    mockFetch(async (url) => (url.includes("/v1/legal/courts") ? new Response("{}", { status: 503 }) : refData(url) ?? new Response("{}", { status: 200 })));
    render(<CreateCaseForm />);
    expect(await screen.findByText(/court and department lists could not be loaded/)).toBeInTheDocument();
    expect(screen.getByLabelText("Court / Forum *")).toBeDisabled();
  });
});

describe("CreateCaseForm — duplicate + redirect (GAP-LEGAL-CASES-NEW-03)", () => {
  beforeEach(() => { pushMock.mockReset(); refreshMock.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("shows a 409 DUPLICATE_CASE_NO as a field error on Case number and does not navigate", async () => {
    mockFetch(async (url) => refData(url, []) ?? new Response(
      JSON.stringify({ code: "DUPLICATE_CASE_NO", message: "a case with this case number already exists" }), { status: 409 }));
    render(<CreateCaseForm />);
    await ready();
    fillMaster();
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));
    const err = await screen.findByText(/A case with this case number already exists/);
    expect(err).toHaveAttribute("id", "caseNo-error");
    expect(screen.getByLabelText("Case number *")).toHaveAttribute("aria-invalid", "true");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("falls back to the list when the new case is not readable yet", async () => {
    mockFetch(async (url) => {
      const r = refData(url, []);
      if (r) return r;
      if (url.includes("/v1/legal/cases/case-9")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ id: "case-9", status: "accepted" }), { status: 202 });
    });
    render(<CreateCaseForm />);
    await ready();
    fillMaster();
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/legal/list"), { timeout: 5000 });
  }, 10000);
});
