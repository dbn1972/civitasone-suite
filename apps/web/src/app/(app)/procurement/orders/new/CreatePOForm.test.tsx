import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

function mockFetch(opts?: { vendors?: Response; indents?: Response; post?: Response }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/procurement/vendors")) return opts?.vendors ?? new Response(JSON.stringify({ data: VENDORS }), { status: 200 });
    if (url.includes("/procurement/indents")) return opts?.indents ?? new Response(JSON.stringify({ data: INDENTS }), { status: 200 });
    if (url.includes("/procurement/pos")) return opts?.post ?? new Response(JSON.stringify({ id: "po-new" }), { status: 202 });
    return new Response(null, { status: 404 });
  });
}

async function fillOneLine() {
  const codeInput = screen.getByLabelText(/Item code, row 1/);
  const descInput = screen.getByLabelText(/Description, row 1/);
  fireEvent.change(codeInput, { target: { value: "IC-1" } });
  fireEvent.change(descInput, { target: { value: "Widget" } });
}

describe("CreatePOForm — NEW-01 no preselect, filtered lists", () => {
  beforeEach(() => { vi.restoreAllMocks(); pushMock.mockReset(); });

  it("does not preselect a vendor or indent and offers 'Select…' placeholders", async () => {
    mockFetch();
    render(<CreatePOForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Acme Supplies" })).toBeInTheDocument());
    const vendorSelect = screen.getByLabelText("Vendor *") as HTMLSelectElement;
    expect(vendorSelect.value).toBe(""); // nothing preselected
  });

  it("does NOT offer a blacklisted vendor or a non-approved indent", async () => {
    mockFetch();
    render(<CreatePOForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Acme Supplies" })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: "Debarred Traders" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /IND\/2026\/02/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /IND\/2026\/01/ })).toBeInTheDocument();
  });
});

describe("CreatePOForm — NEW-03 load failure handling", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("shows an error with Retry (not 'Loading vendors…' forever) when the vendor list 500s", async () => {
    mockFetch({ vendors: new Response(null, { status: 500 }) });
    render(<CreatePOForm />);
    await waitFor(() => expect(screen.getByText(/Couldn’t load vendors/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("CreatePOForm — NEW-02 server-issued poNo", () => {
  beforeEach(() => { vi.restoreAllMocks(); pushMock.mockReset(); });

  it("the POST body does NOT contain a client-generated poNo", async () => {
    const fetchSpy = mockFetch();
    render(<CreatePOForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Acme Supplies" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Vendor *"), { target: { value: "v1" } });
    fireEvent.change(screen.getByLabelText("Source indent (approved) *"), { target: { value: "i1" } });
    await fillOneLine();
    fireEvent.click(screen.getByRole("button", { name: "Create PO" }));

    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find(([i]) => String(typeof i === "string" ? i : (i as Request).url).includes("/procurement/pos") && (fetchSpy.mock.calls.find.length, true));
      return postCall;
    });
    const postCall = fetchSpy.mock.calls.find(([i, init]) =>
      String(typeof i === "string" ? i : (i as Request).url).includes("/procurement/pos") && (init as RequestInit)?.method === "POST");
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.poNo).toBeUndefined();
  });
});

describe("CreatePOForm — NEW-04 indent reconciliation + unit", () => {
  beforeEach(() => { vi.restoreAllMocks(); pushMock.mockReset(); });

  it("blocks and warns when the PO total exceeds the sanctioned indent value", async () => {
    const fetchSpy = mockFetch();
    render(<CreatePOForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Acme Supplies" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Vendor *"), { target: { value: "v1" } });
    fireEvent.change(screen.getByLabelText("Source indent (approved) *"), { target: { value: "i1" } }); // ₹10,000
    await fillOneLine();
    // 1 unit @ ₹20,000 > ₹10,000 indent.
    fireEvent.change(screen.getByLabelText(/Unit price, row 1/), { target: { value: "20000" } });

    await waitFor(() => expect(screen.getByText(/exceeds the sanctioned indent value/)).toBeInTheDocument());
    // Submit is blocked.
    expect(screen.getByRole("button", { name: "Create PO" })).toBeDisabled();
    const posted = fetchSpy.mock.calls.some(([i, init]) =>
      String(typeof i === "string" ? i : (i as Request).url).includes("/procurement/pos") && (init as RequestInit)?.method === "POST");
    expect(posted).toBe(false);
  });

  it("submits the chosen per-line unit (not a hard-coded 'nos')", async () => {
    const fetchSpy = mockFetch();
    render(<CreatePOForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Acme Supplies" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Vendor *"), { target: { value: "v1" } });
    fireEvent.change(screen.getByLabelText("Source indent (approved) *"), { target: { value: "i1" } });
    await fillOneLine();
    fireEvent.change(screen.getByLabelText(/Unit, row 1/), { target: { value: "kg" } });
    fireEvent.change(screen.getByLabelText(/Unit price, row 1/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Create PO" }));

    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find(([i, init]) =>
        String(typeof i === "string" ? i : (i as Request).url).includes("/procurement/pos") && (init as RequestInit)?.method === "POST");
      expect(postCall).toBeTruthy();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body.items[0].unit).toBe("kg");
    });
  });
});

describe("CreatePOForm — NEW-05 delivery date in the past is blocked", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("rejects a past delivery date (min=today pinned to 2026-06-15)", async () => {
    const fetchSpy = mockFetch();
    render(<CreatePOForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Acme Supplies" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Vendor *"), { target: { value: "v1" } });
    fireEvent.change(screen.getByLabelText("Source indent (approved) *"), { target: { value: "i1" } });
    await fillOneLine();
    const dateInput = screen.getByLabelText("Delivery date") as HTMLInputElement;
    expect(dateInput.min).toBe("2026-06-15");
    fireEvent.change(dateInput, { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create PO" }));
    expect(await screen.findByText(/Delivery date cannot be in the past/)).toBeInTheDocument();
    const posted = fetchSpy.mock.calls.some(([i, init]) =>
      String(typeof i === "string" ? i : (i as Request).url).includes("/procurement/pos") && (init as RequestInit)?.method === "POST");
    expect(posted).toBe(false);
  });
});
