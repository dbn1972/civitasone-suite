import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { withEnglishFallback, type MessageTree } from "@/i18n/mergeMessages";
import { ToastProvider } from "@/app/_components/ds/Toast";

// Regression (review of #2462, Hindi): the bill detail page was localised before the record template landed, and
// the template hard-coded English ("Bill", "Payee", "Lodged by", "Bills", "Status", "Approval trail", "by",
// "Passed for payment", "Name not available (ID ending ...)") next to Hindi labels. With locale=hi none of those
// English strings may appear: the shared components read `recordUi`, the page reads `expenditureBillDetail`.
const HI = withEnglishFallback(enMessages as unknown as MessageTree, hiMessages as unknown as MessageTree);

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg?: string | { namespace?: string }) =>
    createTranslator({ locale: "hi", messages: HI, namespace: typeof arg === "string" ? arg : arg?.namespace } as Parameters<typeof createTranslator>[0]),
  getLocale: async () => "hi",
  getMessages: async () => HI,
}));

const render = (ui: React.ReactElement) => rtlRender(
  <NextIntlClientProvider locale="hi" messages={HI}><ToastProvider>{ui}</ToastProvider></NextIntlClientProvider>,
);

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => [], getSessionUserId: () => null }));
const loaderMock = vi.fn();
vi.mock("../../../../../_data/loaders", () => ({
  getFinanceBillById: () => loaderMock(),
  getProcurementPOById: async () => ({ data: null, source: "error" }),
}));
// Neither officer resolves: the unresolved-person wording ("Name not available (ID ending ...)") must be Hindi too.
vi.mock("@/lib/records/recordRefs", () => ({ resolveRecordRefs: async () => ({ people: new Map(), vendors: new Map() }) }));
vi.mock("./BillLineItemsTable", () => ({ BillLineItemsTable: () => null }));
vi.mock("../../../_components/scanned/ScannedDocumentsSection", () => ({ ScannedDocumentsSection: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import BillDetailPage from "./page";

const BILL = {
  id: "b1", billNo: "BILL/2026/0042", vendor: "Acme Traders", amount: "250000", submittedDate: "2026-04-01",
  dueDate: "2026-05-01", status: "passed", threeWayMatch: "matched", poRef: undefined, grnRef: undefined,
  invoiceNo: "INV-9", paymentRef: undefined, lineItems: [],
  createdBy: "00000000-aaaa-4000-8000-00000000c0d8", passedBy: "00000000-bbbb-4000-8000-00000000c0d9",
};

describe("bill detail page in Hindi (no English from the shared record template)", () => {
  beforeEach(() => { loaderMock.mockReset(); loaderMock.mockResolvedValue({ data: BILL, source: "api" }); });

  it("header, parties, back link, trail and unresolved-name wording are all Hindi", async () => {
    const { container } = render(await BillDetailPage({ params: Promise.resolve({ id: "b1" }) }));
    const text = container.textContent ?? "";
    for (const hindi of ["बिल", "प्राप्तकर्ता", "दर्ज करने वाला अधिकारी", "स्थिति", "अनुमोदन का क्रम", "दर्ज किया गया", "भुगतान हेतु पारित", "नाम उपलब्ध नहीं (ID के अंत में c0d8)"]) {
      expect(text, hindi).toContain(hindi);
    }
    for (const english of ["Payee", "Lodged by", "Approval trail", "Passed for payment", "Name not available", "Lodged", "Bills", "Bill summary"]) {
      expect(text, english).not.toContain(english);
    }
    expect(container.querySelector("[data-record-header] dl")?.getAttribute("aria-label")).toBe("बिल सारांश");
    // "Status" label of the header summary and the " by " connector of every trail entry.
    expect(text).not.toMatch(/\bStatus\b/);
    expect(container.querySelector(".tl-title")?.textContent).not.toMatch(/\bby\b/);
  });
});
