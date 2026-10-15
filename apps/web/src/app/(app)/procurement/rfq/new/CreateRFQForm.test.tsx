import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const push = vi.fn();
const refresh = vi.fn();
const toastSuccess = vi.fn();
let searchParamValue: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => ({ get: (_k: string) => searchParamValue }),
}));
vi.mock("@/app/_components/ds", async () => {
  const actual = await vi.importActual<typeof import("@/app/_components/ds")>("@/app/_components/ds");
  return { ...actual, useToast: () => ({ toast: { success: toastSuccess, error: vi.fn(), info: vi.fn() } }) };
});

import { CreateRFQForm } from "./CreateRFQForm";

const INDENTS = {
  data: [
    { id: "ind-approved", indentNo: "IND/2026/1", department: "IT", status: "approved" },
  ],
};
const VENDORS = {
  data: [
    { id: "v1", name: "Acme", blacklisted: false, vendorType: "empanelled" },
    { id: "v2", name: "Beta", blacklisted: false, vendorType: "registered" },
    { id: "v3", name: "Gamma", blacklisted: false, vendorType: "registered" },
    { id: "v4", name: "BadCorp", blacklisted: true, vendorType: "blacklisted" },
  ],
};

let vendorUrls: string[] = [];
let vendorFails = 0;
let postResponse: { status: number; body: unknown } | null = null;

function mockFetch(onPost?: (url: string, body: unknown) => void, indents: unknown = INDENTS) {
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/procurement/indents")) {
      // Assert the form requests only approved indents.
      expect(url).toContain("status=approved");
      return Promise.resolve({ ok: true, json: async () => indents } as unknown as Response);
    }
    if (url.includes("/procurement/vendors")) {
      vendorUrls.push(url);
      if (vendorFails > 0) { vendorFails -= 1; return Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as unknown as Response); }
      // The server filters by ?q= (GAP-PROCUREMENT-RFQ-NEW-04).
      const q = (new URL(url, "http://x").searchParams.get("q") ?? "").toLowerCase();
      const data = VENDORS.data.filter((v) => !q || v.name.toLowerCase().includes(q));
      return Promise.resolve({ ok: true, json: async () => ({ data }) } as unknown as Response);
    }
    // POST /rfqs
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    onPost?.(url, body);
    if (postResponse) {
      return Promise.resolve({ ok: false, status: postResponse.status, text: async () => JSON.stringify(postResponse!.body) } as unknown as Response);
    }
    return Promise.resolve({ ok: true, text: async () => JSON.stringify({ id: "new-rfq" }) } as unknown as Response);
  }) as unknown as typeof fetch;
}

async function selectIndentAndTitleAndDate() {
  const combos = await screen.findAllByRole("combobox");
  fireEvent.change(combos[0], { target: { value: "ind-approved" } });
  fireEvent.change(screen.getByLabelText("RFQ title *"), { target: { value: "Supply" } });
  // closing date far in the future
  const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
  fireEvent.change(dateInput, { target: { value: "2999-12-31" } });
}

describe("CreateRFQForm (GAP-PROCUREMENT-RFQ-NEW-01/02/04/05)", () => {
  beforeEach(() => { push.mockReset(); refresh.mockReset(); toastSuccess.mockReset(); searchParamValue = null; vendorUrls = []; vendorFails = 0; postResponse = null; });
  afterEach(() => vi.restoreAllMocks());

  it("NEW-01: shows each indent's status and drops a non-approved row the API returned anyway", async () => {
    mockFetch(undefined, { data: [
      { id: "ind-approved", indentNo: "IND/2026/1", department: "IT", status: "approved" },
      { id: "ind-draft", indentNo: "IND/2026/2", department: "IT", status: "draft" },
    ] });
    render(<CreateRFQForm />);
    expect(await screen.findByRole("option", { name: /IND\/2026\/1 .*\(approved\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /IND\/2026\/2/ })).not.toBeInTheDocument();
  });

  it("NEW-01: does not auto-select an indent (placeholder stays selected)", async () => {
    mockFetch();
    render(<CreateRFQForm />);
    const combos = await screen.findAllByRole("combobox");
    await waitFor(() => expect((combos[0] as HTMLSelectElement).value).toBe(""));
  });

  it("NEW-01: a ?indent=<id> deep link preselects that approved indent", async () => {
    searchParamValue = "ind-approved";
    mockFetch();
    render(<CreateRFQForm />);
    const combos = await screen.findAllByRole("combobox");
    await waitFor(() => expect((combos[0] as HTMLSelectElement).value).toBe("ind-approved"));
  });

  it("NEW-02: a blacklisted vendor is not selectable (checkbox disabled, badge shown)", async () => {
    mockFetch();
    render(<CreateRFQForm />);
    await screen.findByText("BadCorp");
    const badRow = screen.getByText("BadCorp").closest("label")!;
    const checkbox = badRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(screen.getByText("Blacklisted")).toBeInTheDocument();
  });

  it("NEW-02: inviting fewer than 3 vendors requires a justification before submit", async () => {
    const onPost = vi.fn();
    mockFetch(onPost);
    render(<CreateRFQForm />);
    await selectIndentAndTitleAndDate();
    fireEvent.click((await screen.findByText("Acme")).closest("label")!.querySelector("input")!);
    fireEvent.click(screen.getByRole("button", { name: "Issue RFQ" }));
    expect(await screen.findByText(/At least 3 vendors are required/)).toBeInTheDocument();
    expect(onPost).not.toHaveBeenCalled();
  });

  it("NEW-02: with 3 vendors invited, submit posts and sends NO client rfqNo", async () => {
    let posted: Record<string, unknown> | null = null;
    mockFetch((_u, b) => { posted = b as Record<string, unknown>; });
    render(<CreateRFQForm />);
    await selectIndentAndTitleAndDate();
    for (const name of ["Acme", "Beta", "Gamma"]) {
      fireEvent.click((await screen.findByText(name)).closest("label")!.querySelector("input")!);
    }
    fireEvent.click(screen.getByRole("button", { name: "Issue RFQ" }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.rfqNo).toBeUndefined();
    expect(posted!.vendorIds).toEqual(["v1", "v2", "v3"]);
    expect(posted!.indentRef).toBe("procurement_indent:ind-approved");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("NEW-04: a past closing date is rejected client-side with no POST", async () => {
    const onPost = vi.fn();
    mockFetch(onPost);
    render(<CreateRFQForm />);
    const combos = await screen.findAllByRole("combobox");
    fireEvent.change(combos[0], { target: { value: "ind-approved" } });
    fireEvent.change(screen.getByLabelText("RFQ title *"), { target: { value: "Supply" } });
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2000-01-01" } });
    for (const name of ["Acme", "Beta", "Gamma"]) {
      fireEvent.click((await screen.findByText(name)).closest("label")!.querySelector("input")!);
    }
    fireEvent.click(screen.getByRole("button", { name: "Issue RFQ" }));
    expect(await screen.findByText(/Closing date cannot be in the past/)).toBeInTheDocument();
    expect(onPost).not.toHaveBeenCalled();
  });

  it("NEW-04: the date input has a min attribute (today), blocking past dates in the picker", async () => {
    mockFetch();
    render(<CreateRFQForm />);
    await screen.findAllByRole("combobox");
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput.getAttribute("min")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("NEW-04: vendor search goes to the SERVER (?q=, 25 per query) and narrows the invite list", async () => {
    mockFetch();
    render(<CreateRFQForm />);
    await screen.findByText("Acme");
    fireEvent.change(screen.getByLabelText("Search vendors"), { target: { value: "gamma" } });
    expect(await screen.findByText("Gamma")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Acme")).not.toBeInTheDocument());
    const searched = vendorUrls.find((u) => u.includes("q=gamma"))!;
    expect(searched).toContain("limit=25");
    // No more "first 100 then filter in the browser".
    expect(vendorUrls.some((u) => u.includes("limit=100"))).toBe(false);
  });

  it("NEW-04: a vendor ticked earlier stays selected (and listed) after the search changes", async () => {
    let posted: Record<string, unknown> | null = null;
    mockFetch((_u, b) => { posted = b as Record<string, unknown>; });
    render(<CreateRFQForm />);
    await selectIndentAndTitleAndDate();
    fireEvent.click((await screen.findByText("Acme")).closest("label")!.querySelector("input")!);
    fireEvent.change(screen.getByLabelText("Search vendors"), { target: { value: "gamma" } });
    await screen.findByText("Gamma");
    // Acme is out of this search but still counted and removable.
    expect(await screen.findByTestId("rfq-selected-strip")).toHaveTextContent(/Acme/);
    expect(screen.getByText(/\(1 selected; minimum/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Gamma").closest("label")!.querySelector("input")!);
    fireEvent.change(screen.getByLabelText("Search vendors"), { target: { value: "beta" } });
    fireEvent.click((await screen.findByText("Beta")).closest("label")!.querySelector("input")!);
    fireEvent.click(screen.getByRole("button", { name: "Issue RFQ" }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect((posted!.vendorIds as string[]).sort()).toEqual(["v1", "v2", "v3"]);
  });

  it("NEW-02: each vendor shows its standing (Empanelled / Not empanelled / Blacklisted)", async () => {
    mockFetch();
    render(<CreateRFQForm />);
    await screen.findByText("Acme");
    expect(screen.getByText("Acme").closest("label")).toHaveTextContent("Empanelled");
    expect(screen.getByText("Beta").closest("label")).toHaveTextContent("Not empanelled");
    expect(screen.getByText("BadCorp").closest("label")).toHaveTextContent("Blacklisted");
  });

  it("NEW-04: a failed vendor search shows an error with Retry, not 'no vendors'", async () => {
    vendorFails = 1;
    mockFetch();
    render(<CreateRFQForm />);
    expect(await screen.findByText("Couldn’t search vendors.")).toBeInTheDocument();
    expect(screen.queryByText("No vendors are registered yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Acme")).toBeInTheDocument();
  });

  it("NEW-02: the server's 422 RFQ_MIN_VENDORS rule is explained, not shown as a generic save failure", async () => {
    postResponse = { status: 422, body: { code: "RFQ_MIN_VENDORS", message: "raw server text" } };
    mockFetch();
    render(<CreateRFQForm />);
    await selectIndentAndTitleAndDate();
    for (const name of ["Acme", "Beta", "Gamma"]) {
      fireEvent.click((await screen.findByText(name)).closest("label")!.querySelector("input")!);
    }
    fireEvent.click(screen.getByRole("button", { name: "Issue RFQ" }));
    expect(await screen.findByText(/At least 3 vendors must be invited for a limited tender/)).toBeInTheDocument();
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
