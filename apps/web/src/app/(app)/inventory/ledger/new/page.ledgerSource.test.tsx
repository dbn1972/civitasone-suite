import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("./InventoryEntryForm", () => ({ InventoryEntryForm: () => <div>INVENTORY ENTRY FORM</div> }));
const { default: Page } = await import("./page");

const fetchMock = vi.fn();
const show = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><Page /></NextIntlClientProvider>);
const settings = (body: unknown, status = 200) => fetchMock.mockImplementation(async (url: string) => {
  if (url === "/api/proxy/v1/inventory/settings") return new Response(JSON.stringify(body), { status });
  return new Response(JSON.stringify({ data: [] }), { status: 200 });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("new stock entry picks its form by the tenant's ledger source", () => {
  it("ledgerSource 'inventory' shows the inventory form", async () => {
    settings({ data: { qcMakerChecker: true, ledgerSource: "inventory" } });
    show();
    expect(await screen.findByText("INVENTORY ENTRY FORM")).toBeInTheDocument();
  });

  it("the default ('stock') keeps today's stock-service form", async () => {
    settings({ data: { qcMakerChecker: true, ledgerSource: "stock" } });
    show();
    expect(await screen.findByLabelText("Warehouse (optional)")).toBeInTheDocument();
    expect(screen.queryByText("INVENTORY ENTRY FORM")).toBeNull();
  });

  it("an older service without the field, or an unreadable setting, also keeps the stock-service form", async () => {
    settings({ data: { qcMakerChecker: true } });
    show();
    expect(await screen.findByLabelText("Warehouse (optional)")).toBeInTheDocument();
  });

  it("a 403 on the setting (e.g. a stock-only role) keeps the stock-service form", async () => {
    settings({ code: "FORBIDDEN" }, 403);
    show();
    expect(await screen.findByLabelText("Warehouse (optional)")).toBeInTheDocument();
  });
});
