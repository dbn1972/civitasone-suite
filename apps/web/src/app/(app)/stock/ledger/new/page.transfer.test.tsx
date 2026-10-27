import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

const ITEM_ID = crypto.randomUUID();
const WH_A = crypto.randomUUID();
const WH_B = crypto.randomUUID();
vi.mock("../../../../_components/ds/EntityPicker", () => ({
  EntityPicker: ({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) => (
    <select aria-label="Item" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Select an item</option>
      <option value={ITEM_ID}>A4 Paper</option>
    </select>
  ),
}));

import Page from "./page";

function res(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers(), clone() { return this; } } as unknown as Response;
}

function installFetch(warehousesOk = true) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/stock/warehouses")) {
      return warehousesOk
        ? res(true, 200, { data: [{ id: WH_A, name: "Central Store", code: "CS-01" }, { id: WH_B, name: "Branch Depot", code: "BD-02" }] })
        : res(false, 503, {});
    }
    if (url.includes("/stock/entries") && init?.method === "POST") return res(true, 202, { id: "e1" });
    if (url.includes("/stock/items/")) return res(true, 200, { onHand: 50 });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => pushMock.mockReset());
afterEach(() => vi.unstubAllGlobals());

const posted = (m: ReturnType<typeof installFetch>) => m.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

async function fillTransfer(from: string, to: string) {
  fireEvent.change(screen.getByLabelText("Entry type"), { target: { value: "transfer" } });
  await screen.findAllByRole("option", { name: "Central Store (CS-01)" });
  fireEvent.change(screen.getByLabelText("From warehouse"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("To warehouse"), { target: { value: to } });
  fireEvent.change(screen.getByLabelText("Item"), { target: { value: ITEM_ID } });
  fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "4" } });
}

describe("GAP-STOCK-LEDGER-NEW-01: transfer entries", () => {
  it("offers Transfer with From and To warehouse pickers fed by the warehouse list", async () => {
    installFetch();
    render(<Page />);
    fireEvent.change(screen.getByLabelText("Entry type"), { target: { value: "transfer" } });
    expect((await screen.findAllByRole("option", { name: "Branch Depot (BD-02)" })).length).toBe(2);
    expect(screen.getByLabelText("From warehouse")).toBeInTheDocument();
    expect(screen.getByLabelText("To warehouse")).toBeInTheDocument();
  });

  it("blocks a transfer with only one warehouse chosen", async () => {
    const m = installFetch();
    render(<Page />);
    await fillTransfer(WH_A, "");
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    expect(await screen.findByText("Pick the warehouse the stock goes to.")).toBeInTheDocument();
    expect(posted(m)).toHaveLength(0);
  });

  it("blocks a transfer where source and destination are the same", async () => {
    const m = installFetch();
    render(<Page />);
    await fillTransfer(WH_A, WH_A);
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    expect(await screen.findByText("Destination must differ from the source warehouse.")).toBeInTheDocument();
    expect(posted(m)).toHaveLength(0);
  });

  it("posts both warehouse ids for a valid transfer", async () => {
    const m = installFetch();
    render(<Page />);
    await fillTransfer(WH_A, WH_B);
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    await waitFor(() => expect(posted(m)).toHaveLength(1));
    const body = JSON.parse((posted(m)[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ entryType: "transfer", fromWarehouseId: WH_A, toWarehouseId: WH_B });
  });

  it("sends the single chosen warehouse as the destination for a receipt", async () => {
    const m = installFetch();
    render(<Page />);
    await screen.findAllByRole("option", { name: "Central Store (CS-01)" });
    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: WH_A } });
    fireEvent.change(screen.getByLabelText("Item"), { target: { value: ITEM_ID } });
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/Rate per unit/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    await waitFor(() => expect(posted(m)).toHaveLength(1));
    const body = JSON.parse((posted(m)[0]![1] as RequestInit).body as string);
    expect(body.toWarehouseId).toBe(WH_A);
    expect(body.fromWarehouseId).toBeUndefined();
  });

  it("shows a retry affordance (not an invented id box) when the warehouse list fails", async () => {
    installFetch(false);
    render(<Page />);
    fireEvent.change(screen.getByLabelText("Entry type"), { target: { value: "transfer" } });
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/uuid/i)).toBeNull();
  });
});

describe("GAP-STOCK-LEDGER-NEW-04: structured reason", () => {
  async function submitAdjustment(reason: string) {
    const m = installFetch();
    render(<Page />);
    fireEvent.change(screen.getByLabelText("Entry type"), { target: { value: "adjustment" } });
    if (reason) fireEvent.change(screen.getByLabelText("Reason"), { target: { value: reason } });
    fireEvent.change(screen.getByLabelText("Item"), { target: { value: ITEM_ID } });
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "shelf B3" } });
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    await waitFor(() => expect(posted(m)).toHaveLength(1));
    return JSON.parse((posted(m)[0]![1] as RequestInit).body as string);
  }

  it("sends the reason as its own field and leaves notes untouched", async () => {
    const body = await submitAdjustment("  Damaged in flood ");
    expect(body.reason).toBe("Damaged in flood");
    expect(body.notes).toBe("shelf B3");
  });

  it("omits reason when blank", async () => {
    const body = await submitAdjustment("");
    expect("reason" in body).toBe(false);
  });

  it("does not offer a reason box for receipts", () => {
    installFetch();
    render(<Page />);
    expect(screen.queryByLabelText("Reason")).toBeNull();
  });
});
