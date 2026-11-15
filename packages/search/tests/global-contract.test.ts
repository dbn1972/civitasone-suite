import { describe, it, expect } from "vitest";
import {
  buildGlobalDocument, entityTypesForRoles, findSensitive, redactSensitive, globalDocId,
  GLOBAL_ENTITY_TYPES, GLOBAL_ENTITY_TYPE_LIST, hrefForEntity, isGlobalSearchEnabled, enabledGlobalSearchTenants,
  GlobalSearchContractError,
} from "../src/global/index.js";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const E1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("permissions catalogue", () => {
  it("an employee (and a manager) sees no record type", () => {
    expect(entityTypesForRoles(["employee"])).toEqual([]);
    expect(entityTypesForRoles(["employee", "manager"])).toEqual([]);
    expect(entityTypesForRoles([])).toEqual([]);
    expect(entityTypesForRoles(null)).toEqual([]);
  });
  it("an employee does not see vouchers, bills or vendors; finance does not see employees", () => {
    const fin = entityTypesForRoles(["finance_officer"]);
    expect(fin).toEqual(expect.arrayContaining(["finance.voucher", "finance.bill", "finance.vendor"]));
    expect(fin).not.toContain("hrms.employee");
    expect(entityTypesForRoles(["employee"])).not.toContain("finance.voucher");
  });
  it("hr sees employees only; procurement sees indents/POs/bills only", () => {
    expect(entityTypesForRoles(["hr_officer"])).toEqual(["hrms.employee"]);
    expect(entityTypesForRoles(["procurement_officer"]).sort()).toEqual(["contracts.contract", "finance.bill", "procurement.indent", "procurement.po"]);
  });
  it("tenant_admin sees only meeting.meeting (no blanket access; only entity types whose owning module lists the role count); super_admin sees all", () => {
    expect(entityTypesForRoles(["tenant_admin"])).toEqual(["meeting.meeting"]); // meeting-service's READ_ROLES lists tenant_admin
    expect(entityTypesForRoles(["super_admin"]).sort()).toEqual([...GLOBAL_ENTITY_TYPE_LIST].sort());
  });
  it("unknown roles are ignored", () => {
    expect(entityTypesForRoles(["made_up_role", "FINANCE_OFFICER"])).toEqual([]);
  });
  it("hrefs are same-origin absolute paths", () => {
    for (const t of GLOBAL_ENTITY_TYPE_LIST) {
      const h = hrefForEntity(t, E1, "JV/1 2");
      expect(h.startsWith("/")).toBe(true);
      expect(h.startsWith("//")).toBe(false);
    }
    expect(hrefForEntity("finance.voucher", E1, "JV/1 2")).toBe("/finance/accounting/general-ledger?voucher=JV%2F1%202");
  });
});

describe("indexing contract", () => {
  const base = { entityType: "finance.bill" as const, entityId: E1, tenantId: T1, title: "Bill 42", refNumber: "BILL/2026/0042", status: "pending" };
  it("builds a minimal tenant-stamped document", () => {
    const { doc } = buildGlobalDocument(base, new Date("2026-11-11T00:00:00Z"));
    expect(doc).toEqual({
      id: globalDocId(T1, "finance.bill", E1), tenantId: T1, module: "finance", entityType: "finance.bill", entityId: E1,
      title: "Bill 42", refNumber: "BILL/2026/0042", status: "pending", summary: "", indexedAt: "2026-11-11T00:00:00.000Z",
    });
    expect(Object.keys(doc).sort()).toEqual(["entityId", "entityType", "id", "indexedAt", "module", "refNumber", "status", "summary", "tenantId", "title"]);
  });
  it("document id embeds the tenant so tenants cannot collide", () => {
    expect(globalDocId(T1, "finance.bill", E1)).not.toBe(globalDocId(T2, "finance.bill", E1));
    expect(globalDocId(T1, "finance.bill", E1)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("rejects unknown type, bad ids, empty title", () => {
    expect(() => buildGlobalDocument({ ...base, entityType: "hrms.salary" as never })).toThrow(GlobalSearchContractError);
    expect(() => buildGlobalDocument({ ...base, tenantId: "not-a-uuid" })).toThrow(/tenantId/);
    expect(() => buildGlobalDocument({ ...base, entityId: "1; DROP" })).toThrow(/entityId/);
    expect(() => buildGlobalDocument({ ...base, title: "   " })).toThrow(/title/);
  });
});

describe("no personal data in indexed fields", () => {
  const PAN = "ABCDE1234F";
  const AADHAAR = "2345 6789 0123";
  const samples: Array<[string, string]> = [
    ["pan", `Vendor ${PAN} Ltd`],
    ["aadhaar", `Employee ${AADHAAR}`],
    ["aadhaar", "Employee 234567890123"],
    ["ifsc", "SBIN0001234"],
    ["email", "someone@example.org"],
    ["mobile", "+91 98765 43210".replace(/ /g, "")],
    ["mobile", "9876543210"],
    ["account-number", "1234567890123456"],
    ["pan", "ABCDE 1234 F"],
    ["pan", "ABCDE-1234-F"],
    ["pan", "ABCDE1234 F"],
    ["mobile", "98765 43210"],
    ["mobile", "+91 98765 43210"],
    ["mobile", "+91-98765-43210"],
    ["mobile", "91 9876543210"],
    ["account-number", "123456789"],
    ["account-number", "123456789012345678"],
  ];
  it.each(samples)("detects %s in %s", (name, text) => {
    expect(findSensitive(text)).toContain(name);
  });
  it("redacts every sensitive pattern out of every indexed field", () => {
    const { doc, redactions } = buildGlobalDocument({
      entityType: "hrms.employee", entityId: E1, tenantId: T1,
      title: `Asha Rao ${PAN}`, refNumber: `EMP-001 ${AADHAAR}`, status: "9876543210", summary: "mail a@b.in acct 1234567890123456 SBIN0001234",
    });
    expect(redactions).toBeGreaterThanOrEqual(6);
    const scan = JSON.stringify(doc);
    expect(findSensitive(JSON.stringify([doc.title, doc.refNumber, doc.status, doc.summary]))).toEqual([]);
    expect(scan).not.toContain(PAN);
    expect(scan).not.toContain("9876543210");
    expect(scan).not.toContain("1234567890123456");
  });
  it("redacts the spaced / hyphenated / short variants out of every indexed field", () => {
    const { doc, redactions } = buildGlobalDocument({
      entityType: "procurement.indent", entityId: E1, tenantId: T1, title: "Indent ABCDE-1234-F", refNumber: "IND/1",
      status: "draft", summary: "Repairs, call +91 98765 43210 or 98765 43210, acct 123456789, PAN ABCDE 1234 F",
    });
    expect(redactions).toBe(5);
    expect(findSensitive(JSON.stringify([doc.title, doc.refNumber, doc.status, doc.summary]))).toEqual([]);
  });
  it("ordinary text near the new patterns is left alone", () => {
    for (const t of ["Roads 2026 B", "Block 12 of 2026", "Phase 2 works 2026-27", "Ward 7 ABCDE", "Order 12345678"]) {
      expect(redactSensitive(t)).toEqual({ text: t, redactions: 0 });
    }
  });
  it("ordinary business numbers survive", () => {
    for (const ref of ["PO/2026-27/000123", "JV-2026-0042", "EMP-0001", "IND/ENG/26/17", "BILL/2026/0042"]) {
      expect(redactSensitive(ref)).toEqual({ text: ref, redactions: 0 });
    }
  });
  it("the contract has no field that could carry salary, bank, PAN or address", () => {
    const { doc } = buildGlobalDocument({ entityType: "hrms.employee", entityId: E1, tenantId: T1, title: "Asha Rao", refNumber: "EMP-001", status: "active" });
    for (const k of Object.keys(doc)) expect(k).not.toMatch(/salary|pan|bank|aadhaar|address|mobile|email|dob|ctc/i);
    expect(GLOBAL_ENTITY_TYPES["hrms.employee"].module).toBe("hrms");
  });
});

describe("per-tenant flag (default off)", () => {
  it("is off with no configuration", () => {
    expect(isGlobalSearchEnabled(T1, {})).toBe(false);
    expect(enabledGlobalSearchTenants({}).size).toBe(0);
    expect(isGlobalSearchEnabled(undefined, { GLOBAL_SEARCH_TENANTS: T1 })).toBe(false);
  });
  it("enables exactly the listed tenants; no wildcard; junk ignored", () => {
    const env = { GLOBAL_SEARCH_TENANTS: ` ${T1.toUpperCase()}, *, all, ,not-a-uuid` };
    expect(isGlobalSearchEnabled(T1, env)).toBe(true);
    expect(isGlobalSearchEnabled(T2, env)).toBe(false);
    expect([...enabledGlobalSearchTenants(env)]).toEqual([T1]);
  });
  it("kill switch wins", () => {
    expect(isGlobalSearchEnabled(T1, { GLOBAL_SEARCH_TENANTS: T1, GLOBAL_SEARCH_DISABLED: "1" })).toBe(false);
  });
});
