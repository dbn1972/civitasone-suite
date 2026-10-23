import { describe, it, expect, vi, beforeEach } from "vitest";
// CreatePOForm calls useTranslations(), so render through the English intl wrapper.
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/lib/formatters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/formatters")>();
  return { ...actual, todayIST: () => "2026-06-15" };
});

import { CreatePOForm } from "./CreatePOForm";

const VENDORS = [
  { id: "v1", name: "Acme Supplies", blacklisted: false, kycStatus: "verified" },
  { id: "v2", name: "Debarred Traders", blacklisted: true, kycStatus: "verified" },
];
const INDENTS = [
  { id: "i1", indentNo: "IND/2026/01", department: "Admin", status: "approved", totalMinor: 1000000 }, // ₹10,000
  { id: "i2", indentNo: "IND/2026/02", department: "Admin", status: "draft", totalMinor: 5000000 },
];
const INDENT_DETAIL = {
  id: "i1",
  lineItems: [
    { itemCode: "IC-9", itemName: "Chairs", quantity: 4, unit: "set", unitPriceMinor: 12345 },
    { itemCode: "", itemName: "", quantity: 1, unit: "nos", unitPriceMinor: 0 },
  ],
};
const BANDS = {
  data: [{ id: "DP", nameKey: "procurement.gfr.band.DP.name", notesKey: "procurement.gfr.band.DP.note", requiresTender: false }],
  applicableMode: "DP",
};

type Opts = { vendors?: Response; indents?: Response; post?: Response; bands?: Response; indentDetail?: Response };

function mockFetch(opts?: Opts) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/procurement/vendors")) return opts?.vendors ?? new Response(JSON.stringify({ data: VENDORS }), { status: 200 });
    if (url.includes("/procurement/gfr/mode-bands")) return opts?.bands ?? new Response(JSON.stringify(BANDS), { status: 200 });
    if (/\/procurement\/indents\/i1/.test(url)) return opts?.indentDetail ?? new Response(JSON.stringify(INDENT_DETAIL), { status: 200 });
    if (url.includes("/procurement/indents")) return opts?.indents ?? new Response(JSON.stringify({ data: INDENTS }), { status: 200 });
    if (url.includes("/procurement/pos") && (init as RequestInit | undefined)?.method === "POST") {
      return opts?.post ?? new Response(JSON.stringify({ id: "po-new" }), { status: 202 });
    }
    return new Response(null, { status: 404 });
  });
}

/** Type into a search combobox, then pick the option from the server-searched list. */
async function choose(label: string, typed: string, optionName: RegExp) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: typed } });
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.mouseDown(option);
}
const pickVendor = () => choose("Vendor *", "acme", /Acme Supplies/);
const pickIndent = () => choose("Source indent (approved) *", "IND", /IND\/2026\/01/);

function fillOneLine() {
  fireEvent.change(screen.getByLabelText(/Item code, row 1/), { target: { value: "IC-1" } });
  fireEvent.change(screen.getByLabelText(/Description, row 1/), { target: { value: "Widget" } });
}

function posted(fetchSpy: ReturnType<typeof mockFetch>) {
  return fetchSpy.mock.calls.find(([i, init]) =>
    String(typeof i === "string" ? i : (i as Request).url).includes("/procurement/pos") && (init as RequestInit)?.method === "POST");
}

describe("CreatePOForm — NEW-01 no preselect, filtered lists", () => {
  beforeEach(() => { vi.restoreAllMocks(); pushMock.mockReset(); });

  it("does not preselect a vendor or indent (both pickers start empty)", async () => {
    mockFetch();
    render(<CreatePOForm />);
    expect((screen.getByLabelText("Vendor *") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Source indent (approved) *") as HTMLInputElement).value).toBe("");
  });

  it("does NOT offer a blacklisted vendor or a non-approved indent", async () => {
    mockFetch();
    render(<CreatePOForm />);
    fireEvent.focus(screen.getByLabelText("Vendor *"));
    await screen.findByRole("option", { name: /Acme Supplies/ });
    expect(screen.queryByRole("option", { name: /Debarred Traders/ })).not.toBeInTheDocument();
    fireEvent.focus(screen.getByLabelText("Source indent (approved) *"));
    await screen.findByRole("option", { name: /IND\/2026\/01/ });
    expect(screen.queryByRole("option", { name: /IND\/2026\/02/ })).not.toBeInTheDocument();
  });
});

describe("CreatePOForm — NEW-03 server-side search + load failure handling", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("searches the SERVER (?q=, small page) instead of loading one capped list", async () => {
    const fetchSpy = mockFetch();
    render(<CreatePOForm />);
    await pickVendor();
    await pickIndent();
    const urls = fetchSpy.mock.calls.map(([i]) => String(typeof i === "string" ? i : (i as Request).url));
    const vendorUrl = urls.find((u) => u.includes("/procurement/vendors") && u.includes("q=acme"))!;
    expect(vendorUrl).toContain("limit=25");
    const indentUrl = urls.find((u) => u.includes("/procurement/indents") && u.includes("q=IND"))!;
    expect(indentUrl).toContain("status=approved");
    expect(indentUrl).toContain("limit=25");
    expect(urls.some((u) => u.includes("limit=200"))).toBe(false);
  });

  it("shows an error with Retry (not an empty or 'Loading…' list) when the vendor search 500s, and Retry reloads", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let vendorCalls = 0;
    fetchSpy.mockImplementation(async (input) => {
      const url = String(typeof input === "string" ? input : (input as Request).url);
      if (url.includes("/procurement/vendors")) {
        vendorCalls += 1;
        return vendorCalls === 1 ? new Response(null, { status: 500 }) : new Response(JSON.stringify({ data: VENDORS }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    render(<CreatePOForm />);
    fireEvent.focus(screen.getByLabelText("Vendor *"));
    expect(await screen.findByText("Couldn’t load vendors.")).toBeInTheDocument();
    expect(screen.queryByText("No vendors match your search.")).not.toBeInTheDocument();
    // A failed picker blocks submit. The search state reaches the form from an effect AFTER the
    // error text renders, so wait for the button to reflect it rather than asserting synchronously.
    await waitFor(() => expect(screen.getByRole("button", { name: "Create PO" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("option", { name: /Acme Supplies/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create PO" })).not.toBeDisabled());
  });

  it("shows the empty copy when no approved indent matches", async () => {
    mockFetch({ indents: new Response(JSON.stringify({ data: [] }), { status: 200 }) });
    render(<CreatePOForm />);
    fireEvent.focus(screen.getByLabelText("Source indent (approved) *"));
    expect(await screen.findByText("No approved indents match your search.")).toBeInTheDocument();
  });
});

describe("CreatePOForm — NEW-02 server-issued poNo", () => {
  beforeEach(() => { vi.restoreAllMocks(); pushMock.mockReset(); });

  it("the POST body does NOT contain a client-generated poNo", async () => {
    const fetchSpy = mockFetch();
    render(<CreatePOForm />);
    await pickVendor();
    await pickIndent();
    fillOneLine();
    fireEvent.click(screen.getByRole("button", { name: "Create PO" }));

    await waitFor(() => expect(posted(fetchSpy)).toBeTruthy());
    const body = JSON.parse((posted(fetchSpy)![1] as RequestInit).body as string);
    expect(body.poNo).toBeUndefined();
    expect(body.vendorId).toBe("v1");
    expect(body.indentRef).toBe("procurement_indent:i1");
  });
});

describe("CreatePOForm — NEW-04 indent reconciliation + unit + GFR band", () => {
  beforeEach(() => { vi.restoreAllMocks(); pushMock.mockReset(); });

  it("blocks and warns when the PO total exceeds the sanctioned indent value", async () => {
    const fetchSpy = mockFetch();
    render(<CreatePOForm />);
    await pickVendor();
    await pickIndent(); // ₹10,000
    fillOneLine();
    // 1 unit @ ₹20,000 > ₹10,000 indent.
    fireEvent.change(screen.getByLabelText(/Unit price, row 1/), { target: { value: "20000" } });

    await waitFor(() => expect(screen.getByText(/exceeds the sanctioned indent value/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Create PO" })).toBeDisabled();
    expect(posted(fetchSpy)).toBeUndefined();
  });

  it("submits the chosen per-line unit (not a hard-coded 'nos')", async () => {
    const fetchSpy = mockFetch();
    render(<CreatePOForm />);
    await pickVendor();
    await pickIndent();
    fillOneLine();
    fireEvent.change(screen.getByLabelText(/Unit, row 1/), { target: { value: "kg" } });
    fireEvent.change(screen.getByLabelText(/Unit price, row 1/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Create PO" }));

    await waitFor(() => {
      expect(posted(fetchSpy)).toBeTruthy();
      const body = JSON.parse((posted(fetchSpy)![1] as RequestInit).body as string);
      expect(body.items[0].unit).toBe("kg");
    });
  });

  it("shows the GFR procurement-mode band for the PO total (asked with the exact paise)", async () => {
    const fetchSpy = mockFetch();
    render(<CreatePOForm />);
    fillOneLine();
    fireEvent.change(screen.getByLabelText(/Unit price, row 1/), { target: { value: "1500.50" } });
    const band = await screen.findByTestId("po-mode-band");
    await waitFor(() => expect(band).toHaveTextContent("DP"));
    expect(band).toHaveTextContent("Direct Purchase");
    const bandUrl = fetchSpy.mock.calls.map(([i]) => String(i)).find((u) => u.includes("/gfr/mode-bands"))!;
    expect(bandUrl).toContain("estimatedValueMinor=150050");
  });

  it("says the tender-requirement check did not run when the band lookup fails", async () => {
    mockFetch({ bands: new Response(null, { status: 500 }) });
    render(<CreatePOForm />);
    fillOneLine();
    fireEvent.change(screen.getByLabelText(/Unit price, row 1/), { target: { value: "100" } });
    expect(await screen.findByText(/tender-requirement check did not run/)).toBeInTheDocument();
  });

  it("'Copy lines from indent' prefills complete lines with exact rupees and the indent's unit", async () => {
    mockFetch();
    render(<CreatePOForm />);
    expect(screen.queryByRole("button", { name: "Copy lines from indent" })).not.toBeInTheDocument();
    await pickIndent();
    fireEvent.click(screen.getByRole("button", { name: "Copy lines from indent" }));
    await waitFor(() => expect((screen.getByLabelText(/Item code, row 1/) as HTMLInputElement).value).toBe("IC-9"));
    expect((screen.getByLabelText(/Description, row 1/) as HTMLInputElement).value).toBe("Chairs");
    expect((screen.getByLabelText(/Unit price, row 1/) as HTMLInputElement).value).toBe("123.45");
    expect((screen.getByLabelText(/Unit, row 1/) as HTMLSelectElement).value).toBe("set");
    // The blank line from the indent is not copied.
    expect(screen.queryByLabelText(/Item code, row 2/)).not.toBeInTheDocument();
  });

  it("reports a failed indent-line copy and keeps the existing lines", async () => {
    mockFetch({ indentDetail: new Response(null, { status: 500 }) });
    render(<CreatePOForm />);
    await pickIndent();
    fillOneLine();
    fireEvent.click(screen.getByRole("button", { name: "Copy lines from indent" }));
    expect(await screen.findByText(/Couldn’t load the indent lines/)).toBeInTheDocument();
    expect((screen.getByLabelText(/Item code, row 1/) as HTMLInputElement).value).toBe("IC-1");
  });
});

describe("CreatePOForm — NEW-05 delivery date in the past is blocked", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("rejects a past delivery date (min=today pinned to 2026-06-15)", async () => {
    const fetchSpy = mockFetch();
    render(<CreatePOForm />);
    await pickVendor();
    await pickIndent();
    fillOneLine();
    const dateInput = screen.getByLabelText("Delivery date") as HTMLInputElement;
    expect(dateInput.min).toBe("2026-06-15");
    fireEvent.change(dateInput, { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create PO" }));
    expect(await screen.findByText(/Delivery date cannot be in the past/)).toBeInTheDocument();
    expect(posted(fetchSpy)).toBeUndefined();
  });
});

describe("CreatePOForm — w0-report: synchronous 422 VENDOR_BLACKLISTED", () => {
  beforeEach(() => { vi.restoreAllMocks(); pushMock.mockReset(); });

  it("shows the blacklisted-vendor message (not the generic one) and does not navigate", async () => {
    mockFetch({
      post: new Response(JSON.stringify({ code: "VENDOR_BLACKLISTED", message: "raw server text xyz" }), { status: 422 }),
    });
    render(<CreatePOForm />);
    await pickVendor();
    await pickIndent();
    fillOneLine();
    fireEvent.change(screen.getByLabelText(/Unit price, row 1/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Create PO" }));

    await screen.findByText(/This vendor is blacklisted and cannot be used on a purchase order/);
    expect(screen.queryByText(/raw server text xyz/)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("requires both a vendor and an indent (translated message) before posting", async () => {
    const fetchSpy = mockFetch();
    render(<CreatePOForm />);
    fillOneLine();
    fireEvent.click(screen.getByRole("button", { name: "Create PO" }));
    expect(await screen.findByText("Choose a vendor and an approved indent, and add at least one complete line item.")).toBeInTheDocument();
    expect(posted(fetchSpy)).toBeUndefined();
  });
});
