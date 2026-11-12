import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { GlobalSearch, safeRecordHref, entityTypeKey } from "./GlobalSearch";

/**
 * Cross-module records in the global search box: grouped by record type, linked to the record page, keyboard
 * navigable in visual order, English and Hindi, and robust to a hostile `href`.
 */
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const V = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const B1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const B2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const E = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";

const rec = (over: Record<string, unknown>) => ({ module: "finance", name: "x", refNumber: null, description: null, status: "active", snippet: "", ...over });
const BODY = {
  data: [
    rec({ id: V, name: "Acme Traders", refNumber: null, entityType: "finance.vendor", entityLabel: "Vendors", href: `/finance/vendors/${V}` }),
    rec({ id: B1, name: "Bill BILL-1", refNumber: "BILL-1", entityType: "finance.bill", entityLabel: "Bills", href: `/finance/expenditure/bills/${B1}` }),
    rec({ id: E, module: "hrms", name: "Acme Asha", refNumber: "EMP-1", entityType: "hrms.employee", entityLabel: "Employees", href: `/hr/employees/${E}` }),
    rec({ id: B2, name: "Bill BILL-2", refNumber: "BILL-2", entityType: "finance.bill", entityLabel: "Bills", href: `/finance/expenditure/bills/${B2}` }),
  ],
  meta: { page: 1, pageSize: 20, total: 4 },
};
const respond = (body: unknown, status = 200) => vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body });
const open = () => act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })); });

beforeEach(() => mockPush.mockReset());
afterEach(() => vi.restoreAllMocks());

async function search(q = "Acme", wrap?: (n: React.ReactNode) => React.ReactNode) {
  const ui = <GlobalSearch />;
  render(<>{wrap ? wrap(ui) : ui}</>);
  open();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: q } });
  await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
}

describe("cross-module records in global search", () => {
  it("groups hits by record type, in visual order, with one labelled group each", async () => {
    global.fetch = respond(BODY);
    await search();
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-labelledby") && document.getElementById(g.getAttribute("aria-labelledby")!)!.textContent)).toEqual(["Vendors", "Bills", "Employees"]);
    const bills = within(groups[1]!).getAllByRole("option");
    expect(bills).toHaveLength(2);
    expect(bills[0]).toHaveTextContent("Bill BILL-1");
  });

  it("opens the record page of the hit, by click", async () => {
    global.fetch = respond(BODY);
    await search();
    fireEvent.click(screen.getByRole("option", { name: /Acme Asha/ }));
    expect(mockPush).toHaveBeenCalledWith(`/hr/employees/${E}`);
  });

  it("is keyboard navigable in the order shown (the second bill is reached after the first, before employees)", async () => {
    global.fetch = respond(BODY);
    await search();
    const input = screen.getByRole("combobox");
    await waitFor(() => expect(document.activeElement).toBe(input));
    for (let i = 0; i < 3; i++) fireEvent.keyDown(document, { key: "ArrowDown" }); // vendor, bill 1, bill 2
    expect(input).toHaveAttribute("aria-activedescendant", "search-result-2");
    fireEvent.keyDown(document, { key: "Enter" });
    expect(mockPush).toHaveBeenCalledWith(`/finance/expenditure/bills/${B2}`);
  });

  it("shows Hindi group headings when the locale is Hindi", async () => {
    global.fetch = respond(BODY);
    await search("Acme", (ui) => <NextIntlClientProvider locale="hi" messages={hiMessages}>{ui}</NextIntlClientProvider>);
    const labels = screen.getAllByRole("group").map((g) => document.getElementById(g.getAttribute("aria-labelledby")!)!.textContent);
    expect(labels).toEqual(["विक्रेता", "बिल", "कर्मचारी"]);
  });

  it("has an English and a Hindi heading for every record type the catalogue can return", () => {
    for (const k of ["financeVoucher", "financeBill", "financeVendor", "hrmsEmployee", "procurementIndent", "procurementPo", "contractsContract", "meetingMeeting", "estabFile", "citizenApplication"]) {
      const find = (m: unknown): Record<string, string> | undefined => {
        if (m && typeof m === "object") {
          const o = m as Record<string, unknown>;
          if ("recordsPartial" in o) return o.types as Record<string, string>;
          for (const v of Object.values(o)) { const r = find(v); if (r) return r; }
        }
        return undefined;
      };
      expect(find(enMessages)?.[k]).toBeTruthy();
      expect(find(hiMessages)?.[k]).toBeTruthy();
    }
  });

  it("legacy knowledge hits (no entityType) still show under 'Records' and fall back to the module landing", async () => {
    global.fetch = respond({ data: [rec({ id: "doc-1", module: "knowledge", name: "Leave policy", snippet: "..." })], meta: { page: 1, pageSize: 20, total: 1 } });
    await search("leave");
    const opt = await screen.findByRole("option", { name: /Leave policy/ });
    expect(opt.closest('[role="group"]')).toHaveTextContent("Records");
    fireEvent.click(opt);
    expect(mockPush).toHaveBeenCalledWith("/knowledge");
  });

  it("ignores an unsafe href from the server and uses the module landing instead", async () => {
    global.fetch = respond({ data: [rec({ id: V, name: "Evil", entityType: "finance.vendor", entityLabel: "Vendors", href: "https://evil.example/x" })], meta: { page: 1, pageSize: 20, total: 1 } });
    await search("evil");
    fireEvent.click(await screen.findByRole("option", { name: /Evil/ }));
    expect(mockPush).toHaveBeenCalledWith("/finance");
  });

  it("tells the user, accessibly, when part of the record search failed", async () => {
    global.fetch = respond({ ...BODY, meta: { ...BODY.meta, recordsUnavailable: true } });
    await search();
    expect(screen.getByText("Some records could not be searched right now. Showing the rest.")).toBeInTheDocument();
  });
});

describe("safeRecordHref / entityTypeKey", () => {
  it("accepts only same-origin absolute paths", () => {
    expect(safeRecordHref("/finance/vendors/1")).toBe("/finance/vendors/1");
    for (const bad of ["//evil.example", "https://evil.example", "javascript:alert(1)", "finance/x", "/a\\b", "/a\nb", "", null, undefined, 5]) {
      expect(safeRecordHref(bad)).toBeNull();
    }
  });
  it("maps entity types to message keys", () => {
    expect(entityTypeKey("finance.bill")).toBe("financeBill");
    expect(entityTypeKey("procurement.po")).toBe("procurementPo");
  });
});
