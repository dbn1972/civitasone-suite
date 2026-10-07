import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
    { id: "v1", name: "Acme", blacklisted: false },
    { id: "v2", name: "Beta", blacklisted: false },
    { id: "v3", name: "Gamma", blacklisted: false },
    { id: "v4", name: "BadCorp", blacklisted: true },
  ],
};

function mockFetch(onPost?: (url: string, body: unknown) => void) {
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/procurement/indents")) {
      // Assert the form requests only approved indents.
      expect(url).toContain("status=approved");
      return Promise.resolve({ ok: true, json: async () => INDENTS } as unknown as Response);
    }
    if (url.includes("/procurement/vendors")) {
      return Promise.resolve({ ok: true, json: async () => VENDORS } as unknown as Response);
    }
    // POST /rfqs
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    onPost?.(url, body);
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
  beforeEach(() => { push.mockReset(); refresh.mockReset(); toastSuccess.mockReset(); searchParamValue = null; });
  afterEach(() => vi.restoreAllMocks());

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

  it("NEW-04: vendor search narrows the invite list", async () => {
    mockFetch();
    render(<CreateRFQForm />);
    await screen.findByText("Acme");
    fireEvent.change(screen.getByLabelText("Search vendors"), { target: { value: "gamma" } });
    expect(screen.getByText("Gamma")).toBeInTheDocument();
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
  });
});
