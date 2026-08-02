/**
 * Billing money-safety tests (R7 money codec).
 *
 * Money crosses the works-service HTTP/queue boundary as a base-10 STRING
 * (never a bare JS `number`) so paise above 2^53 (~₹9,007 cr) never lose
 * precision. `zMoneyMinorString` (validators) normalises the wire value to a
 * canonical string; `parseMinor` (consumer) rebuilds an exact `bigint` from
 * it before any arithmetic.
 */
import { describe, it, expect } from "vitest";
import { parseMinor } from "@civitasone/schemas";
import { createBillSchema } from "../src/modules/billing/validators.js";
import { addBoqItemSchema, recapitulateSchema } from "../src/modules/boq/validators.js";
import { createAwardSchema } from "../src/modules/tender/validators.js";
import { createAaSchema } from "../src/modules/approval/validators.js";
import { calculateNetPayable } from "../src/modules/billing/domain.js";

describe("money codec — billing validators (zMoneyMinorString)", () => {
  it("accepts a large decimal string above 2^53 and round-trips as an exact bigint", () => {
    const bigPaise = "900700000000000001"; // ~₹9,007 cr + 1 paisa
    const parsed = createBillSchema.parse({
      workId: "00000000-1111-4000-8000-000000000001",
      awardId: "00000000-2222-4000-8000-000000000001",
      billMode: "e_mb",
      billNumber: "BILL/2024/999",
      grossAmountMinor: bigPaise,
      deductionsMinor: "0",
    });
    // zMoneyMinorString normalises to a canonical base-10 string.
    expect(parsed.grossAmountMinor).toBe(bigPaise);
    expect(parseMinor(parsed.grossAmountMinor)).toBe(900700000000000001n);
  });

  it("rejects Number.MAX_SAFE_INTEGER + 1 supplied as a JS number", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 2; // already lossy as a JS number
    expect(() =>
      createBillSchema.parse({
        workId: "00000000-1111-4000-8000-000000000001",
        awardId: "00000000-2222-4000-8000-000000000001",
        billMode: "e_mb",
        billNumber: "BILL/2024/998",
        grossAmountMinor: unsafe,
      }),
    ).toThrow(/safe-integer/);
  });

  it("accepts a safe-integer JS number and normalises it to a string", () => {
    const parsed = createBillSchema.parse({
      workId: "00000000-1111-4000-8000-000000000001",
      awardId: "00000000-2222-4000-8000-000000000001",
      billMode: "abstract",
      billNumber: "BILL/2024/997",
      grossAmountMinor: 500000,
    });
    expect(parsed.grossAmountMinor).toBe("500000");
  });

  it("rejects a non-numeric junk string", () => {
    expect(() =>
      createBillSchema.parse({
        workId: "00000000-1111-4000-8000-000000000001",
        awardId: "00000000-2222-4000-8000-000000000001",
        billMode: "abstract",
        billNumber: "BILL/2024/996",
        grossAmountMinor: "not-a-number",
      }),
    ).toThrow();
  });
});

describe("money codec — boq / tender / approval validators", () => {
  it("boq addBoqItemSchema.rate round-trips a large paise string", () => {
    const bigPaise = "123456789012345678";
    const parsed = addBoqItemSchema.parse({
      workId: "00000000-1111-4000-8000-000000000001",
      itemDescription: "Excavation",
      unit: "cum",
      rate: bigPaise,
      quantity: 10,
    });
    expect(parsed.rate).toBe(bigPaise);
    expect(parseMinor(parsed.rate)).toBe(123456789012345678n);
  });

  it("boq recapitulateSchema.otherCharges rejects an unsafe number", () => {
    expect(() =>
      recapitulateSchema.parse({
        workId: "00000000-1111-4000-8000-000000000001",
        contingencyPercent: 1,
        turnoverTaxPercent: 1,
        workChargePercent: 1,
        qualityControlPercent: 1,
        centagePercent: 1,
        otherCharges: Number.MAX_SAFE_INTEGER + 2,
      }),
    ).toThrow(/safe-integer/);
  });

  it("tender createAwardSchema.acceptedAmountMinor round-trips a large paise string", () => {
    const bigPaise = "999999999999999999";
    const parsed = createAwardSchema.parse({
      workId: "00000000-1111-4000-8000-000000000001",
      contractorName: "ABC Constructions",
      acceptedAmountMinor: bigPaise,
    });
    expect(parsed.acceptedAmountMinor).toBe(bigPaise);
    expect(parseMinor(parsed.acceptedAmountMinor)).toBe(999999999999999999n);
  });

  it("approval createAaSchema.approvedAmountMinor rejects an unsafe number", () => {
    expect(() =>
      createAaSchema.parse({
        workId: "00000000-1111-4000-8000-000000000001",
        aaNumber: "AA/2024/001",
        aaDate: "2024-01-01",
        approvingAuthorityId: "00000000-3333-4000-8000-000000000001",
        approvedAmountMinor: Number.MAX_SAFE_INTEGER + 2,
      }),
    ).toThrow(/safe-integer/);
  });
});

describe("calculateNetPayable — bigint correctness at large scale", () => {
  it("computes gross - deductions exactly above 2^53", () => {
    const gross = parseMinor("900700000000000001");
    const deductions = parseMinor("100000000000000001");
    expect(calculateNetPayable(gross, deductions)).toBe(800700000000000000n);
  });

  it("matches BigInt arithmetic exactly (no float rounding)", () => {
    const gross = 9_007_199_254_740_993n; // 2^53 + 1
    const deductions = 1n;
    expect(calculateNetPayable(gross, deductions)).toBe(9_007_199_254_740_992n);
  });
});

describe("money codec — proposal validators (zMoneyMinorString)", () => {
  it("createProposalSchema.estimatedCostMinor round-trips a large paise string above 2^53", async () => {
    const { createProposalSchema } = await import("../src/modules/proposal/validators.js");
    const bigPaise = "900700000000000001";
    const parsed = createProposalSchema.parse({
      description: "Road repair NH-48",
      category: "regular",
      workTypeId: "00000000-1111-4000-8000-000000000001",
      estimatedCostMinor: bigPaise,
    });
    expect(parsed.estimatedCostMinor).toBe(bigPaise);
    expect(parseMinor(parsed.estimatedCostMinor)).toBe(900700000000000001n);
  });

  it("createProposalSchema.estimatedCostMinor rejects Number.MAX_SAFE_INTEGER + 2 as a JS number", async () => {
    const { createProposalSchema } = await import("../src/modules/proposal/validators.js");
    const unsafe = Number.MAX_SAFE_INTEGER + 2;
    expect(() =>
      createProposalSchema.parse({
        description: "Road repair",
        category: "regular",
        workTypeId: "00000000-1111-4000-8000-000000000001",
        estimatedCostMinor: unsafe,
      }),
    ).toThrow(/safe-integer/);
  });

  it("createProposalSchema.estimatedCostMinor rejects a non-numeric junk string", async () => {
    const { createProposalSchema } = await import("../src/modules/proposal/validators.js");
    expect(() =>
      createProposalSchema.parse({
        description: "Road repair",
        category: "regular",
        workTypeId: "00000000-1111-4000-8000-000000000001",
        estimatedCostMinor: "not-a-number",
      }),
    ).toThrow();
  });

  it("createProposalSchema.estimatedCostMinor normalises a safe-integer JS number to a string", async () => {
    const { createProposalSchema } = await import("../src/modules/proposal/validators.js");
    const parsed = createProposalSchema.parse({
      description: "Road repair",
      category: "regular",
      workTypeId: "00000000-1111-4000-8000-000000000001",
      estimatedCostMinor: 500000,
    });
    expect(parsed.estimatedCostMinor).toBe("500000");
  });
});

describe("money codec — masters validators (zMoneyMinorString)", () => {
  it("createSrItemSchema.rate round-trips a large paise string above 2^53", async () => {
    const { createSrItemSchema } = await import("../src/modules/masters/validators.js");
    const bigPaise = "123456789012345678";
    const parsed = createSrItemSchema.parse({
      zone: "North",
      srYear: "2026",
      itemCode: "IT-001",
      description: "Excavation in ordinary soil",
      unit: "cum",
      rate: bigPaise,
    });
    expect(parsed.rate).toBe(bigPaise);
    expect(parseMinor(parsed.rate)).toBe(123456789012345678n);
  });

  it("createSrItemSchema.rate rejects Number.MAX_SAFE_INTEGER + 2 as a JS number", async () => {
    const { createSrItemSchema } = await import("../src/modules/masters/validators.js");
    const unsafe = Number.MAX_SAFE_INTEGER + 2;
    expect(() =>
      createSrItemSchema.parse({
        zone: "North", srYear: "2026", itemCode: "IT-002",
        description: "desc", unit: "cum", rate: unsafe,
      }),
    ).toThrow(/safe-integer/);
  });

  it("createAssetSchema.cost round-trips a large paise string above 2^53", async () => {
    const { createAssetSchema } = await import("../src/modules/masters/validators.js");
    const bigPaise = "987654321098765432";
    const parsed = createAssetSchema.parse({
      code: "AST-1", name: "Bridge over river", cost: bigPaise,
    });
    expect(parsed.cost).toBe(bigPaise);
    expect(parseMinor(parsed.cost as string)).toBe(987654321098765432n);
  });

  it("createAssetSchema.cost rejects Number.MAX_SAFE_INTEGER + 2 as a JS number", async () => {
    const { createAssetSchema } = await import("../src/modules/masters/validators.js");
    const unsafe = Number.MAX_SAFE_INTEGER + 2;
    expect(() =>
      createAssetSchema.parse({ code: "AST-2", name: "Bridge", cost: unsafe }),
    ).toThrow(/safe-integer/);
  });

  it("createAssetSchema.cost is optional and omitting it is still valid", async () => {
    const { createAssetSchema } = await import("../src/modules/masters/validators.js");
    const parsed = createAssetSchema.parse({ code: "AST-3", name: "Culvert" });
    expect(parsed.cost).toBeUndefined();
  });
});
