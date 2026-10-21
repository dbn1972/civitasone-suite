import { describe, it, expect } from "vitest";
import {
  AMOUNT_FIELDS,
  AMOUNT_FIELD_MAP,
  parseTaxDeclarationResponse,
  taxDeclarationSchema,
  unwrapDeclarationPayload,
} from "./taxDeclaration";

// GAP-PAYROLL-TAX-DECLARATION-03: root vs { data } shapes, malformed bodies, units.
const DECLARATION = {
  id: "d1",
  employeeId: "e1",
  fy: "2026-27",
  regime: "old",
  section80c: 15000000,
  section80d: 2500000,
  otherDeductions: 100,
  rentPaidMinor: 24000000,
  prevEmployerSalaryMinor: 0,
  otherSourcesIncomeMinor: 5,
  perquisitesMinor: 123456,
  status: "submitted",
  createdAt: "2026-04-02T10:00:00.000Z",
  updatedAt: "2026-04-03T10:00:00.000Z",
  landlordName: "A Landlord",
  landlordPanMasked: "ABCDE****F",
};

describe("unwrapDeclarationPayload", () => {
  it("returns the same declaration for the root shape and the { data } shape", () => {
    expect(unwrapDeclarationPayload(DECLARATION)).toEqual(DECLARATION);
    expect(unwrapDeclarationPayload({ data: DECLARATION })).toEqual(DECLARATION);
  });

  it("never unwraps a root declaration just because it also has some other key", () => {
    expect(unwrapDeclarationPayload({ ...DECLARATION, data: "x" })).toEqual({ ...DECLARATION, data: "x" });
  });

  it("passes null/primitives through untouched", () => {
    expect(unwrapDeclarationPayload(null)).toBeNull();
    expect(unwrapDeclarationPayload("oops")).toBe("oops");
    expect(unwrapDeclarationPayload({ data: null })).toBeNull();
  });
});

describe("parseTaxDeclarationResponse", () => {
  it("root and { data } yield the SAME parsed fields (exact paise preserved)", () => {
    const root = parseTaxDeclarationResponse(DECLARATION);
    const wrapped = parseTaxDeclarationResponse({ data: DECLARATION });
    expect(root.kind).toBe("ok");
    expect(wrapped).toEqual(root);
    if (root.kind !== "ok") throw new Error("unreachable");
    expect(root.declaration).toMatchObject({
      regime: "old",
      section80c: 15000000,
      section80d: 2500000,
      otherDeductions: 100,
      rentPaidMinor: 24000000,
      prevEmployerSalaryMinor: 0,
      otherSourcesIncomeMinor: 5,
      perquisitesMinor: 123456,
      status: "submitted",
    });
  });

  it("accepts all-digit strings for bigint amounts and converts them to numbers", () => {
    const r = parseTaxDeclarationResponse({ ...DECLARATION, section80c: "15000000", perquisitesMinor: "0" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.declaration.section80c).toBe(15000000);
      expect(r.declaration.perquisitesMinor).toBe(0);
    }
  });

  it("the three optional amounts may be absent (the form shows them blank) but not malformed", () => {
    const { prevEmployerSalaryMinor, otherSourcesIncomeMinor, perquisitesMinor, ...core } = DECLARATION;
    void prevEmployerSalaryMinor; void otherSourcesIncomeMinor; void perquisitesMinor;
    expect(parseTaxDeclarationResponse(core).kind).toBe("ok");
    expect(parseTaxDeclarationResponse({ data: { ...core, perquisitesMinor: null } }).kind).toBe("ok");
    expect(parseTaxDeclarationResponse({ ...core, perquisitesMinor: -5 })).toEqual({ kind: "invalid" });
  });

  it("null / { data: null } mean the employee has no declaration yet", () => {
    expect(parseTaxDeclarationResponse(null)).toEqual({ kind: "none" });
    expect(parseTaxDeclarationResponse(undefined)).toEqual({ kind: "none" });
    expect(parseTaxDeclarationResponse({ data: null })).toEqual({ kind: "none" });
  });

  it.each([
    ["empty object", {}],
    ["error envelope served with a 200", { code: "INTERNAL", message: "boom" }],
    ["wrapped empty object", { data: {} }],
    ["wrapped array", { data: [] }],
    ["an array", []],
    ["a string", "ok"],
    ["a number", 3],
    ["unknown regime", { ...DECLARATION, regime: "hybrid" }],
    ["missing regime", { ...DECLARATION, regime: undefined }],
    ["core amount missing", { ...DECLARATION, section80c: undefined }],
    ["core amount null", { ...DECLARATION, rentPaidMinor: null }],
    ["amount negative", { ...DECLARATION, section80d: -1 }],
    ["amount fractional (not paise)", { ...DECLARATION, otherDeductions: 10.5 }],
    ["amount a non-numeric string", { ...DECLARATION, perquisitesMinor: "1,000" }],
    ["amount not a safe integer", { ...DECLARATION, section80c: 9007199254740993 }],
    ["status of the wrong type", { ...DECLARATION, status: 3 }],
  ])("reports %s as invalid (never as blank fields)", (_label, body) => {
    expect(parseTaxDeclarationResponse(body)).toEqual({ kind: "invalid" });
  });
});

describe("AMOUNT_FIELD_MAP", () => {
  it("maps every form field to an API field the schema reads, in paise", () => {
    expect(AMOUNT_FIELDS).toHaveLength(7);
    const r = parseTaxDeclarationResponse(DECLARATION);
    if (r.kind !== "ok") throw new Error("unreachable");
    const declared = r.declaration as unknown as Record<string, unknown>;
    for (const f of AMOUNT_FIELDS) {
      expect(typeof declared[AMOUNT_FIELD_MAP[f]]).toBe("number");
    }
    // ...and every mapped name is a key of the schema (a typo here would silently prefill blanks)
    const schemaKeys = Object.keys(taxDeclarationSchema.shape);
    for (const f of AMOUNT_FIELDS) expect(schemaKeys).toContain(AMOUNT_FIELD_MAP[f]);
  });

  it("uses the API's own names (the deduction fields carry no Minor suffix but are still paise)", () => {
    expect(AMOUNT_FIELD_MAP).toEqual({
      section80c: "section80c",
      section80d: "section80d",
      otherDeductions: "otherDeductions",
      rentPaid: "rentPaidMinor",
      prevEmployerSalary: "prevEmployerSalaryMinor",
      otherSourcesIncome: "otherSourcesIncomeMinor",
      perquisites: "perquisitesMinor",
    });
  });
});
