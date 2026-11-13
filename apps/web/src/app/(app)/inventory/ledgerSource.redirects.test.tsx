import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

class Redirect extends Error { constructor(public to: string) { super(`redirect:${to}`); } }
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Redirect(to); }, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const loaders = vi.hoisted(() => ({ getStockItemById: vi.fn() }));
vi.mock("@/app/_data/loaders", () => loaders);
const links = vi.hoisted(() => ({ getUnmatchedReport: vi.fn(), getLinkSuggestions: vi.fn() }));
vi.mock("./_dataLinks", () => links);
const ledger = vi.hoisted(() => ({ getInventoryLedgerSource: vi.fn() }));
vi.mock("./_dataLedger", async (importOriginal) => ({ ...(await importOriginal<typeof import("./_dataLedger")>()), ...ledger }));
vi.mock("./RegisterLinkCard", () => ({ RegisterLinkCard: () => <div>LINK CARD</div> }));
vi.mock("../stock/_components/PrintExportButton", () => ({ PrintExportButton: () => null }));

const { default: StockItemPage } = await import("./[id]/page");
const { default: UnlinkedPage } = await import("./items/unlinked/page");

beforeEach(() => vi.clearAllMocks());

describe("stock-register-only screens on the inventory ledger", () => {
  it("the stock item page sends the user to the stock list and never queries stock-service", async () => {
    ledger.getInventoryLedgerSource.mockResolvedValue({ source: "api", data: "inventory" });
    await expect(StockItemPage({ params: Promise.resolve({ id: "s1" }) })).rejects.toMatchObject({ to: "/inventory/list" });
    expect(loaders.getStockItemById).not.toHaveBeenCalled();
  });

  it("the unlinked-items report goes back to the item master", async () => {
    ledger.getInventoryLedgerSource.mockResolvedValue({ source: "api", data: "inventory" });
    await expect(UnlinkedPage()).rejects.toMatchObject({ to: "/inventory/items" });
    expect(links.getUnmatchedReport).not.toHaveBeenCalled();
  });

  it("stock mode keeps both screens", async () => {
    ledger.getInventoryLedgerSource.mockResolvedValue({ source: "api", data: "stock" });
    loaders.getStockItemById.mockResolvedValue({ data: null, source: "api", status: 404 });
    render(await StockItemPage({ params: Promise.resolve({ id: "s1" }) }));
    expect(screen.getByText("Item not found")).toBeInTheDocument();
  });
});
