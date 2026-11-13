import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("./InventoryEntryForm", () => ({
  InventoryEntryForm: (p: { canAdjust?: boolean }) => <div>INVENTORY ENTRY FORM canAdjust={String(p.canAdjust)}</div>,
}));
const { default: Page } = await import("./page");

const fetchMock = vi.fn();
const show = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><Page /></NextIntlClientProvider>);
const source = (body: unknown, status = 200) => fetchMock.mockImplementation(async (url: string) => {
  if (url === "/api/proxy/v1/inventory/ledger-source") return new Response(JSON.stringify(body), { status });
  return new Response(JSON.stringify({ data: [] }), { status: 200 });
});
const legacyForm = () => screen.queryByLabelText("Warehouse (optional)");
const stockPosts = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("/v1/stock/entries"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("new stock entry picks its form by the tenant's ledger source", () => {
  it("ledgerSource 'inventory' shows the inventory form (also for a stock_manager: the route is open to the stock roles)", async () => {
    source({ data: { ledgerSource: "inventory", canAdjust: false } });
    show();
    expect(await screen.findByText("INVENTORY ENTRY FORM canAdjust=false")).toBeInTheDocument();
    expect(legacyForm()).toBeNull();
  });

  it("the default ('stock'), a missing field, and a service without the route keep today's stock-service form", async () => {
    for (const [body, status] of [[{ data: { ledgerSource: "stock" } }, 200], [{ data: {} }, 200], [{}, 404]] as const) {
      source(body, status);
      const view = show();
      expect(await screen.findByLabelText("Warehouse (optional)")).toBeInTheDocument();
      view.unmount();
    }
  });

  it.each([[500], [503], [403]])("a %i on the setting shows a retry error and NO form (never the stock-service one)", async (status) => {
    source({ code: "X" }, status);
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("nothing was posted");
    expect(legacyForm()).toBeNull();
    expect(screen.queryByText(/INVENTORY ENTRY FORM/)).toBeNull();
    expect(stockPosts()).toHaveLength(0);
  });

  it("a network failure or an unreadable body is also an error state", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    const first = show();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(legacyForm()).toBeNull();
    first.unmount();
    source("not an object");
    show();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("Try again re-reads the setting and then shows the right form", async () => {
    source({}, 500);
    show();
    await screen.findByRole("alert");
    source({ data: { ledgerSource: "inventory", canAdjust: true } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("INVENTORY ENTRY FORM canAdjust=true")).toBeInTheDocument();
  });
});
