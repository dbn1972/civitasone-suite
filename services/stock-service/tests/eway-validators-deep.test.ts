/**
 * Stock Service — E-Way Bill Validators: Comprehensive boundary tests.
 *
 * Tests GSTIN format (15-char regex), PIN code (6-digit), state codes,
 * supply types, document types, transport modes, and cancel/update validators.
 *
 * Source: modules/eway-bill/validators.ts
 */
import { describe, it, expect } from "vitest";
import { createEwayBillBody, cancelEwayBillBody, updateVehicleBody, listQueryParams, idParam } from "../src/modules/eway-bill/validators.js";

const validEway = {
  supplyType: "outward" as const,
  subSupplyType: "supply" as const,
  docType: "invoice" as const,
  docNo: "INV-2026-001",
  docDate: "2026-07-15",
  fromGstin: "29ABCDE1234F1Z5",
  fromName: "Supplier Corp",
  fromAddr: "123 Main Road, Bangalore",
  fromPin: "560001",
  fromStateCode: "29",
  toName: "Buyer Ltd",
  toAddr: "456 Market St, Chennai",
  toPin: "600001",
  toStateCode: "33",
  totalValueMinor: 500000,
  hsnCode: "8471",
};

describe("createEwayBillBody — GSTIN validation", () => {
  it("accepts valid GSTIN (15-char formatted)", () => expect(createEwayBillBody.safeParse(validEway).success).toBe(true));
  it("rejects short GSTIN", () => expect(createEwayBillBody.safeParse({ ...validEway, fromGstin: "29ABCDE" }).success).toBe(false));
  it("rejects lowercase GSTIN", () => expect(createEwayBillBody.safeParse({ ...validEway, fromGstin: "29abcde1234f1z5" }).success).toBe(false));
  it("toGstin is optional", () => expect(createEwayBillBody.safeParse(validEway).success).toBe(true));
  it("toGstin rejects invalid format when provided", () => expect(createEwayBillBody.safeParse({ ...validEway, toGstin: "BAD" }).success).toBe(false));
});

describe("createEwayBillBody — PIN code validation", () => {
  it("accepts 6-digit PIN", () => expect(createEwayBillBody.safeParse(validEway).success).toBe(true));
  it("rejects 5-digit PIN", () => expect(createEwayBillBody.safeParse({ ...validEway, fromPin: "56000" }).success).toBe(false));
  it("rejects alphabetic PIN", () => expect(createEwayBillBody.safeParse({ ...validEway, toPin: "ABCDEF" }).success).toBe(false));
});

describe("createEwayBillBody — state code validation", () => {
  it("accepts 2-digit state code", () => expect(createEwayBillBody.safeParse(validEway).success).toBe(true));
  it("rejects 3-digit", () => expect(createEwayBillBody.safeParse({ ...validEway, fromStateCode: "290" }).success).toBe(false));
  it("rejects 1-digit", () => expect(createEwayBillBody.safeParse({ ...validEway, toStateCode: "3" }).success).toBe(false));
});

describe("createEwayBillBody — enums", () => {
  it("accepts all supplyTypes", () => {
    for (const t of ["outward", "inward"]) expect(createEwayBillBody.safeParse({ ...validEway, supplyType: t }).success).toBe(true);
  });
  it("rejects invalid supplyType", () => expect(createEwayBillBody.safeParse({ ...validEway, supplyType: "transit" }).success).toBe(false));
  it("accepts all subSupplyTypes", () => {
    for (const t of ["supply", "export", "job_work", "for_own_use", "sales_return", "others"]) expect(createEwayBillBody.safeParse({ ...validEway, subSupplyType: t }).success).toBe(true);
  });
  it("accepts all docTypes", () => {
    for (const t of ["invoice", "bill", "challan", "credit_note", "others"]) expect(createEwayBillBody.safeParse({ ...validEway, docType: t }).success).toBe(true);
  });
  it("accepts all transportModes", () => {
    for (const t of ["road", "rail", "air", "ship"]) expect(createEwayBillBody.safeParse({ ...validEway, transportMode: t }).success).toBe(true);
  });
  it("rejects invalid transportMode", () => expect(createEwayBillBody.safeParse({ ...validEway, transportMode: "pipeline" }).success).toBe(false));
});

describe("createEwayBillBody — value + HSN", () => {
  it("rejects zero totalValueMinor", () => expect(createEwayBillBody.safeParse({ ...validEway, totalValueMinor: 0 }).success).toBe(false));
  it("rejects negative totalValueMinor", () => expect(createEwayBillBody.safeParse({ ...validEway, totalValueMinor: -100 }).success).toBe(false));
  it("hsnCode min 4 max 8 chars", () => {
    expect(createEwayBillBody.safeParse({ ...validEway, hsnCode: "847" }).success).toBe(false); // < 4
    expect(createEwayBillBody.safeParse({ ...validEway, hsnCode: "84719000X" }).success).toBe(false); // > 8
    expect(createEwayBillBody.safeParse({ ...validEway, hsnCode: "84719000" }).success).toBe(true); // exactly 8
  });
});

describe("createEwayBillBody — date format", () => {
  it("accepts YYYY-MM-DD", () => expect(createEwayBillBody.safeParse(validEway).success).toBe(true));
  it("rejects DD/MM/YYYY", () => expect(createEwayBillBody.safeParse({ ...validEway, docDate: "15/07/2026" }).success).toBe(false));
});

describe("cancelEwayBillBody", () => {
  it("accepts reason >= 5 chars", () => expect(cancelEwayBillBody.safeParse({ reason: "Duplicate entry" }).success).toBe(true));
  it("rejects reason < 5 chars", () => expect(cancelEwayBillBody.safeParse({ reason: "Dup" }).success).toBe(false));
  it("rejects reason > 250 chars", () => expect(cancelEwayBillBody.safeParse({ reason: "x".repeat(251) }).success).toBe(false));
});

describe("updateVehicleBody", () => {
  it("accepts valid vehicle number", () => expect(updateVehicleBody.safeParse({ vehicleNo: "KA01AB1234" }).success).toBe(true));
  it("rejects vehicleNo < 4 chars", () => expect(updateVehicleBody.safeParse({ vehicleNo: "KA" }).success).toBe(false));
  it("rejects vehicleNo > 20 chars", () => expect(updateVehicleBody.safeParse({ vehicleNo: "x".repeat(21) }).success).toBe(false));
  it("accepts optional transportMode", () => expect(updateVehicleBody.safeParse({ vehicleNo: "KA01AB1234", transportMode: "rail" }).success).toBe(true));
});

describe("listQueryParams", () => {
  it("accepts valid status filter", () => {
    for (const s of ["pending", "active", "cancelled", "expired", "failed"]) expect(listQueryParams.safeParse({ status: s }).success).toBe(true);
  });
  it("rejects invalid status", () => expect(listQueryParams.safeParse({ status: "draft" }).success).toBe(false));
  it("defaults limit=50, offset=0", () => {
    const r = listQueryParams.safeParse({});
    expect(r.success && r.data.limit).toBe(50);
    expect(r.success && r.data.offset).toBe(0);
  });
  it("rejects limit > 500", () => expect(listQueryParams.safeParse({ limit: 501 }).success).toBe(false));
});

describe("idParam", () => {
  it("accepts UUID", () => expect(idParam.safeParse({ id: "10000000-aaaa-4000-8000-000000000001" }).success).toBe(true));
  it("rejects non-UUID", () => expect(idParam.safeParse({ id: "bad" }).success).toBe(false));
});
