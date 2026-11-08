import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { PAGE_INDEX, normaliseQuery, searchPages } from "./pageIndex";

/**
 * UAT-P3 (NAV-01 / S-01): "leave", "DDO", "journal voucher" and "PO/2026" all
 * answered "Search is temporarily unavailable". The page index answers
 * without the backend, with the abbreviations officers actually type.
 */
const APP = join(process.cwd(), "src/app/(app)");
const top = (q: string, access = {}) => searchPages(q, access)[0]?.entry.href;

describe("search page index", () => {
  it.each([
    ["DDO", "/hr/payroll/ddos"],
    ["JV", "/finance/accounting/vouchers/new"],
    ["GRN", "/procurement/grn"],
    ["HoA", "/finance/chart-of-accounts"],
    ["UC", "/finance/expenditure/utilization-certificates"],
    ["APAR", "/hr/apar"],
    ["journal voucher", "/finance/accounting/vouchers/new"],
    ["purchase order", "/procurement/orders"],
    ["payslip", "/hr/payroll/my-slips"],
  ])("%s finds %s first", (q, href) => {
    expect(top(q)).toBe(href);
  });

  it("answers the UAT queries that used to dead-end", () => {
    expect(searchPages("leave", {}).map((h) => h.entry.href)).toEqual(expect.arrayContaining(["/hr/leave/apply", "/hr/leave/approvals"]));
    expect(searchPages("ddo", {}).length).toBeGreaterThan(0);
  });

  it("matches Hindi names in either language", () => {
    expect(top("छुट्टी")).toBe("/hr/leave/apply");
    expect(searchPages("वेतन पर्ची", {}).map((h) => h.entry.href)).toContain("/hr/payroll/my-slips");
    expect(top("लेखा शीर्ष")).toBe("/finance/chart-of-accounts");
  });

  it("matches the translated label passed by the caller", () => {
    const hits = searchPages("मेरी कर", {}, (e) => (e.id === "myTaxDeclaration" ? "मेरी कर घोषणा" : e.label));
    expect(hits[0]?.entry.href).toBe("/hr/payroll/tax-declaration");
  });

  it("leaves record references to record search (no page swallows PO/2026)", () => {
    expect(searchPages("PO/2026", {})).toEqual([]);
  });

  it("only offers pages the user can open", () => {
    const crm = searchPages("JV", { roles: ["crm_user"] }).map((h) => h.entry.href);
    expect(crm).not.toContain("/finance/accounting/vouchers/new");
    const fin = searchPages("JV", { roles: ["finance_officer"] }).map((h) => h.entry.href);
    expect(fin).toContain("/finance/accounting/vouchers/new");
    expect(searchPages("DDO", { roles: ["employee"] }).map((h) => h.entry.href)).not.toContain("/hr/payroll/ddos");
  });

  it("needs two characters and caps the list", () => {
    expect(searchPages("a", {})).toEqual([]);
    expect(searchPages("re", {}, undefined, 5).length).toBeLessThanOrEqual(5);
  });

  it("normalises case, punctuation and keeps Devanagari vowel signs", () => {
    expect(normaliseQuery("  G.R.N  ")).toBe("g r n");
    expect(normaliseQuery("छुट्टी")).toBe("छुट्टी");
  });

  it("every indexed page exists and has an en + hi label", () => {
    const enNav = (en as unknown as { appNav: Record<string, Record<string, string>> }).appNav;
    const hiNav = (hi as unknown as { appNav: Record<string, Record<string, string>> }).appNav;
    for (const e of PAGE_INDEX) {
      expect(existsSync(join(APP, e.href, "page.tsx")), e.href).toBe(true);
      if (e.id === "dashboard") continue; // nav.dashboard (GAP-DASHBOARD-HOME-2-05)
      expect(enNav[e.kind]?.[e.id], `en ${e.kind}.${e.id}`).toBeTruthy();
      expect(hiNav[e.kind]?.[e.id], `hi ${e.kind}.${e.id}`).toBeTruthy();
    }
  });
});
