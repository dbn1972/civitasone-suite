import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

// GAP-STOCK-LEDGER-NEW-08: EntityPicker is used for item selection.
// Mock it as a plain select for test purposes so tests can drive it without
// the full debounced-search flow.
const ITEM_ID = "11111111-1111-4111-8111-111111111111";
vi.mock("../../../../_components/ds/EntityPicker", () => ({
  EntityPicker: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (v: string | null) => void;
  }) => (
    <select
      aria-label="Item"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">Select an item</option>
      <option value={ITEM_ID}>A4 Paper</option>
    </select>
  ),
}));

import Page from "./page";

function res(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers(), clone() { return this; } } as unknown as Response;
}

function installFetch(createImpl?: () => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/stock/entries") && init?.method === "POST") return createImpl ? createImpl() : res(true, 202, { id: "e1" });
    // Item detail fetch for on-hand (non-critical)
    if (url.includes("/stock/items/")) return res(true, 200, { onHand: 50 });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => { pushMock.mockReset(); refreshMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

// Helpers
function getQtyInput() { return screen.getByLabelText(/Quantity/i); }
function getRateInput() { return screen.getByLabelText(/Rate per unit/i); }
function getItemSelect() { return screen.getByLabelText("Item"); }
function getEntryTypeSelect() { return screen.getByLabelText("Entry type"); }
function getSubmitBtn() { return screen.getByRole("button", { name: "Record entry" }); }

describe("New Stock Entry page (target of the /stock/ledger/new links)", () => {
  it("blocks submit and shows field errors when item and quantity are missing", async () => {
    const fetchMock = installFetch();
    render(<Page />);
    fireEvent.click(getSubmitBtn());
    expect(await screen.findByText("Pick an item.")).toBeInTheDocument();
    expect(screen.getByText("Enter a quantity greater than zero.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("posts the entry with the rate converted to paise", async () => {
    const fetchMock = installFetch();
    render(<Page />);
    fireEvent.change(getItemSelect(), { target: { value: ITEM_ID } });
    fireEvent.change(getQtyInput(), { target: { value: "10" } });
    fireEvent.change(getRateInput(), { target: { value: "12.50" } });
    fireEvent.click(getSubmitBtn());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/submitted/i));
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.entryType).toBe("receipt");
    expect(body.items).toEqual([{ itemId: ITEM_ID, qty: 10, rateMinor: 1250, currency: "INR" }]);
  });

  it("rejects a rate with sub-paise or non-plain-decimal input instead of posting zero", async () => {
    for (const bad of ["12.345", "1e3"]) {
      const fetchMock = installFetch();
      const { unmount } = render(<Page />);
      fireEvent.change(getItemSelect(), { target: { value: ITEM_ID } });
      fireEvent.change(getQtyInput(), { target: { value: "10" } });
      fireEvent.change(getRateInput(), { target: { value: bad } });
      fireEvent.click(getSubmitBtn());
      expect(await screen.findByText(/Rate must be a positive amount/)).toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
      unmount();
    }
  });

  // GAP-STOCK-LEDGER-NEW-02: decimal quantity is accepted.
  it("GAP-STOCK-LEDGER-NEW-02: accepts a decimal quantity (fractional UOM)", async () => {
    const fetchMock = installFetch();
    render(<Page />);
    fireEvent.change(getItemSelect(), { target: { value: ITEM_ID } });
    fireEvent.change(getQtyInput(), { target: { value: "2.5" } });
    fireEvent.change(getRateInput(), { target: { value: "10.00" } });
    fireEvent.click(getSubmitBtn());
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true)
    );
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.items[0].qty).toBe(2.5);
  });

  // GAP-STOCK-LEDGER-NEW-02: adjustment direction: decrease sends negative qty.
  it("GAP-STOCK-LEDGER-NEW-02: adjustment decrease sends a negative signed qty", async () => {
    const fetchMock = installFetch();
    render(<Page />);
    fireEvent.change(getEntryTypeSelect(), { target: { value: "adjustment" } });
    // Direction select appears for adjustment
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "decrease" } });
    fireEvent.change(getItemSelect(), { target: { value: ITEM_ID } });
    fireEvent.change(getQtyInput(), { target: { value: "5" } });
    fireEvent.click(getSubmitBtn());
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true)
    );
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.items[0].qty).toBe(-5);
  });

  // GAP-STOCK-LEDGER-NEW-07: two lines are posted in one request.
  it("GAP-STOCK-LEDGER-NEW-07: two lines are submitted in one POST request", async () => {
    const fetchMock = installFetch();
    render(<Page />);
    // Fill first line
    fireEvent.change(getItemSelect(), { target: { value: ITEM_ID } });
    fireEvent.change(getQtyInput(), { target: { value: "5" } });
    fireEvent.change(getRateInput(), { target: { value: "10.00" } });
    // Add a second line
    fireEvent.click(screen.getByRole("button", { name: "+ Add line" }));
    const itemSelects = screen.getAllByLabelText("Item");
    const qtyInputs = screen.getAllByLabelText(/Quantity/i);
    const rateInputs = screen.getAllByLabelText(/Rate per unit/i);
    expect(itemSelects).toHaveLength(2);
    fireEvent.change(itemSelects[1]!, { target: { value: ITEM_ID } });
    fireEvent.change(qtyInputs[1]!, { target: { value: "3" } });
    fireEvent.change(rateInputs[1]!, { target: { value: "20.00" } });
    fireEvent.click(getSubmitBtn());
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true)
    );
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].qty).toBe(5);
    expect(body.items[1].qty).toBe(3);
  });
});

describe("GAP-STOCK-LEDGER-NEW-06: posting date uses IST today and rejects future", () => {
  it("rejects a date in the future before posting", async () => {
    installFetch();
    render(<Page />);
    fireEvent.change(getItemSelect(), { target: { value: ITEM_ID } });
    fireEvent.change(getQtyInput(), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Posting date"), { target: { value: "2099-01-01" } });
    fireEvent.click(getSubmitBtn());
    expect(await screen.findByText(/cannot be in the future/i)).toBeInTheDocument();
  });
});

describe("GAP-STOCK-LEDGER-NEW-03: rate required for receipts", () => {
  it("blocks a receipt with blank rate and shows an error", async () => {
    const fetchMock = installFetch();
    render(<Page />);
    fireEvent.change(getItemSelect(), { target: { value: ITEM_ID } });
    fireEvent.change(getQtyInput(), { target: { value: "5" } });
    // Leave rate blank
    fireEvent.click(getSubmitBtn());
    expect(await screen.findByText(/Rate is required for receipts/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("blocks a receipt with zero rate", async () => {
    const fetchMock = installFetch();
    render(<Page />);
    fireEvent.change(getItemSelect(), { target: { value: ITEM_ID } });
    fireEvent.change(getQtyInput(), { target: { value: "5" } });
    fireEvent.change(getRateInput(), { target: { value: "0" } });
    fireEvent.click(getSubmitBtn());
    expect(await screen.findByText(/Rate is required for receipts/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("allows an issue with blank rate (optional for non-receipt)", async () => {
    const fetchMock = installFetch(() => res(true, 202, { id: "e2" }));
    render(<Page />);
    fireEvent.change(getEntryTypeSelect(), { target: { value: "issue" } });
    fireEvent.change(getItemSelect(), { target: { value: ITEM_ID } });
    fireEvent.change(getQtyInput(), { target: { value: "5" } });
    // No rate
    fireEvent.click(getSubmitBtn());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/submitted/i));
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true);
  });
});
