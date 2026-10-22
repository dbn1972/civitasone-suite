import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

// Unlike details.test.tsx (which stubs getTranslations to echo the key), this uses the real catalogue, so a message key the page
// asks for but en.json / hi.json do not define shows up as raw key text and fails here.
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => [], getSessionUserId: () => null }));
const loaderMock = vi.fn();
vi.mock("../../../../../_data/loaders", () => ({ getFinanceBillById: () => loaderMock() }));
vi.mock("./BillLineItemsTable", () => ({ BillLineItemsTable: () => null }));
vi.mock("../../../_components/scanned/ScannedDocumentsSection", () => ({ ScannedDocumentsSection: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import BillDetailPage from "./page";

// GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-01
describe("bill detail failed-load copy comes from the message catalogue", () => {
  beforeEach(() => { loaderMock.mockReset(); });

  it("a 500 shows a readable header and names the area, not raw message keys", async () => {
    loaderMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const { container } = render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.getByRole("heading", { name: "Bill Detail" })).toBeInTheDocument();
    expect(container.textContent).toMatch(/couldn.t load the bill details/i);
    expect(container.textContent).not.toContain("expenditureBillDetail.");
  });

  it("a 404 still says the bill was not found", async () => {
    loaderMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.getByText("Bill not found")).toBeInTheDocument();
  });

  it("every key the failed-load state and the maker-checker notes use exists in both languages", () => {
    const keys = ["titleLoadFailed", "areaBill", "cannotPassOwn", "cannotReleaseLodged", "cannotReleasePassed"];
    for (const messages of [enMessages, hiMessages]) {
      const ns = (messages as unknown as Record<string, Record<string, string>>).expenditureBillDetail!;
      for (const key of keys) expect(ns[key], key).toBeTruthy();
    }
  });
});
