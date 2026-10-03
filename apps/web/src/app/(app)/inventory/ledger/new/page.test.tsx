import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const search = vi.hoisted(() => ({ q: "itemId=s1" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.q),
}));
const { default: Page } = await import("./page");

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  search.q = "itemId=s1";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/proxy/v1/stock/items/s1")) return json({ id: "s1", code: "pen-01", name: "Gel Pen Blue" });
    if (url.startsWith("/api/proxy/v1/inventory/item-links/lookup")) return json({ data: { inventoryItemId: "i1" } });
    if (url.startsWith("/api/proxy/v1/inventory/items/i1")) return json({ id: "i1", name: "Gel Pen", sku: "PEN-01" });
    if (url.startsWith("/api/proxy/v1/inventory/item-picker")) {
      return json({ data: [{ key: "i1", kind: "linked", inventoryItemId: "i1", stockItemId: "s1", code: "PEN-01", name: "Gel Pen", stockCode: "pen-01" }] });
    }
    if (url === "/api/proxy/v1/stock/entries") return json({}, 202);
    throw new Error(`unexpected ${url}`);
  });
});

const show = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><Page /></NextIntlClientProvider>);

describe("new stock entry: the single item picker", () => {
  it("a preselected stock id shows as the one merged item, and the entry carries the STOCK-side id", async () => {
    show();
    expect(await screen.findByDisplayValue("PEN-01 · Gel Pen")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Post entry" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(dialog.querySelector("textarea, input")!, { target: { value: "opening stock" } });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Post entry")!);
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/proxy/v1/stock/entries")).toBe(true));
    const post = fetchMock.mock.calls.find((c) => c[0] === "/api/proxy/v1/stock/entries")!;
    expect(JSON.parse(post[1].body).items[0].itemId).toBe("s1");
  });

  it("only items that exist on the stock side are offered (masters=stock)", async () => {
    search.q = "";
    show();
    fireEvent.change(screen.getByLabelText("Item"), { target: { value: "pen" } });
    await screen.findByText("PEN-01 · Gel Pen");
    const pickerCall = fetchMock.mock.calls.find((c) => String(c[0]).startsWith("/api/proxy/v1/inventory/item-picker"))!;
    expect(String(pickerCall[0])).toContain("masters=stock");
    expect(screen.getByRole("button", { name: "Post entry" })).toBeDisabled(); // nothing chosen yet
  });

  it("an unknown preselected id shows a plain load error, not a blank form", async () => {
    fetchMock.mockImplementation(async () => new Response("", { status: 404 }));
    show();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
