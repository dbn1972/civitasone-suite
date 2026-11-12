import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("../../_revalidate", () => ({ purgeInventoryCache: vi.fn(async () => undefined) }));
// The picker has its own tests; here it just hands back an inventory-only item.
vi.mock("@/app/_components/ItemPicker", () => ({
  ItemPicker: (p: { masters?: string; onChange: (e: unknown) => void }) => (
    <button type="button" data-masters={p.masters} onClick={() => p.onChange({ key: "i1", kind: "inventory_only", inventoryItemId: "i1", stockItemId: null, code: "A4", name: "A4 Paper", stockCode: null })}>
      pick item
    </button>
  ),
}));

const { InventoryEntryForm, pollOptions } = await import("./InventoryEntryForm");

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const fetchMock = vi.fn();
let onHand = 40;
let movementStatus = 200;

beforeEach(() => {
  vi.clearAllMocks();
  onHand = 40;
  movementStatus = 200;
  pollOptions.intervalMs = 1;
  pollOptions.attempts = 3;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url.startsWith("/api/proxy/v1/inventory/stores")) return json({ data: [{ id: "s1", name: "Main Store", code: "MAIN" }, { id: "s2", name: "Annex", code: "ANX" }] });
    if (url.startsWith("/api/proxy/v1/inventory/balances")) return json({ data: [{ onHandQty: onHand }] });
    if (url.startsWith("/api/proxy/v1/inventory/movements/")) return json({}, movementStatus);
    if (init?.method === "POST" && url.startsWith("/api/proxy/v1/inventory/")) return json({ id: "m1", status: "accepted" }, 202);
    throw new Error(`unexpected ${url}`);
  });
});

const show = (messages: object = enMessages, locale = "en") =>
  render(<NextIntlClientProvider locale={locale} messages={messages}><InventoryEntryForm /></NextIntlClientProvider>);
const posts = () => fetchMock.mock.calls.filter((c) => c[1]?.method === "POST");
const calledUrls = () => fetchMock.mock.calls.map((c) => String(c[0]));

async function fill(type: string, store: string, qty: string) {
  await screen.findByRole("option", { name: "MAIN · Main Store" });
  fireEvent.change(screen.getByLabelText("Entry type"), { target: { value: type } });
  fireEvent.click(screen.getByRole("button", { name: "pick item" }));
  fireEvent.change(screen.getByLabelText(/store/i, { selector: "#ie-store" }), { target: { value: store } });
  fireEvent.change(screen.getByLabelText(/Quantity|Counted quantity/), { target: { value: qty } });
}
async function confirmPost(reason = "monthly consumption") {
  fireEvent.click(screen.getByRole("button", { name: "Post entry" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.change(dialog.querySelector("textarea, input")!, { target: { value: reason } });
  fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Post entry")!);
}

describe("stock entry on the inventory ledger", () => {
  it("searches the item master only and never calls stock-service", async () => {
    show();
    await fill("issue", "s1", "5");
    expect(screen.getByRole("button", { name: "pick item" })).toHaveAttribute("data-masters", "inventory");
    await confirmPost();
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(calledUrls().some((u) => u.includes("/v1/stock/"))).toBe(false);
  });

  it("an issue posts the inventory item id and the store to /v1/inventory/issues, then opens the movement", async () => {
    show();
    await fill("issue", "s1", "5");
    expect(await screen.findByText("On hand in this store: 40")).toBeInTheDocument();
    await confirmPost();
    await waitFor(() => expect(posts()).toHaveLength(1));
    const [url, init] = posts()[0]!;
    expect(url).toBe("/api/proxy/v1/inventory/issues");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ fromStoreId: "s1", lines: [{ itemId: "i1", qty: 5 }] });
    expect(body.notes).toContain("monthly consumption");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/inventory/movements/m1"));
  });

  it("blocks an issue larger than the stock on hand before anything is sent", async () => {
    show();
    await fill("issue", "s1", "41");
    await screen.findByText("On hand in this store: 40");
    fireEvent.click(screen.getByRole("button", { name: "Post entry" }));
    expect(await screen.findByText("Only 40 unit(s) are on hand in this store.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("a receipt carries the rate in paise to /v1/inventory/receipts", async () => {
    show();
    await fill("receipt", "s1", "100");
    fireEvent.change(screen.getByLabelText(/Rate/), { target: { value: "250.50" } });
    await confirmPost("opening stock");
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![0]).toBe("/api/proxy/v1/inventory/receipts");
    expect(JSON.parse(posts()[0]![1].body)).toMatchObject({ toStoreId: "s1", lines: [{ itemId: "i1", qty: 100, rateMinor: 25050 }] });
  });

  it("a transfer needs a different destination store", async () => {
    show();
    await fill("transfer", "s1", "5");
    fireEvent.click(screen.getByRole("button", { name: "Post entry" }));
    expect(await screen.findByText("Choose a different store to transfer to.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("To store"), { target: { value: "s2" } });
    await confirmPost("rebalancing");
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![0]).toBe("/api/proxy/v1/inventory/transfers");
    expect(JSON.parse(posts()[0]![1].body)).toMatchObject({ fromStoreId: "s1", toStoreId: "s2" });
  });

  it("an adjustment sends the counted quantity and requires a reason code", async () => {
    show();
    await fill("adjustment", "s1", "37");
    fireEvent.click(screen.getByRole("button", { name: "Post entry" }));
    expect(await screen.findByText("Enter a reason code for the adjustment.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason code"), { target: { value: "COUNT" } });
    await confirmPost("annual count");
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![0]).toBe("/api/proxy/v1/inventory/adjustments");
    expect(JSON.parse(posts()[0]![1].body)).toMatchObject({ storeId: "s1", reasonCode: "COUNT", lines: [{ itemId: "i1", countedQty: 37 }] });
  });

  it("an accepted entry that never appears is reported as pending, not as posted", async () => {
    movementStatus = 404;
    show();
    await fill("issue", "s1", "5");
    await confirmPost();
    expect(await screen.findByText(/has not been posted yet/)).toBeInTheDocument();
    expect(screen.queryByText("Stock entry posted.")).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("says so when the organisation has no stores", async () => {
    fetchMock.mockImplementation(async (url: string) => (url.startsWith("/api/proxy/v1/inventory/stores") ? json({ data: [] }) : json({})));
    show();
    expect(await screen.findByText(/No stores exist yet/)).toBeInTheDocument();
  });

  it("renders in Hindi", async () => {
    show(hiMessages, "hi");
    expect(await screen.findByText("नई स्टॉक प्रविष्टि")).toBeInTheDocument();
    expect(screen.getByLabelText("प्रविष्टि का प्रकार")).toBeInTheDocument();
  });
});
