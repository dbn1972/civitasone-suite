/**
 * Procurement — Indent: Deep domain + validators.
 *
 * Tests state machine transitions, maker-checker SOD, indent approval gate,
 * and validator boundaries (items, procurement mode, fields).
 *
 * Source: modules/indent/domain.ts, modules/indent/validators.ts
 */
import { describe, it, expect } from "vitest";
import {
  assertTransitionAllowed,
  assertDistinctMakerChecker,
  assertIndentApproved,
  DomainError,
  type IndentStatus,
} from "../src/modules/indent/domain.js";
import { createIndentBody, approveIndentBody, rejectIndentBody, idParam } from "../src/modules/indent/validators.js";

// ═══ State Machine ═══

describe("assertTransitionAllowed — indent status machine", () => {
  const valid: [string, IndentStatus][] = [
    ["draft", "pending"],
    ["pending", "approved"],
    ["pending", "rejected"],
    ["pending", "tender_required"],
    ["tender_required", "approved"],
    ["tender_required", "rejected"],
    ["approved", "closed"],
  ];
  for (const [from, to] of valid) {
    it(`${from} → ${to} is valid`, () => {
      expect(() => assertTransitionAllowed(from, to)).not.toThrow();
    });
  }

  const invalid: [string, IndentStatus][] = [
    ["draft", "approved"], ["draft", "rejected"], ["draft", "closed"],
    ["pending", "closed"], ["pending", "draft"],
    ["approved", "draft"], ["approved", "rejected"],
    ["rejected", "approved"], ["rejected", "draft"], ["rejected", "pending"],
    ["closed", "draft"], ["closed", "approved"],
  ];
  for (const [from, to] of invalid) {
    it(`${from} → ${to} is illegal`, () => {
      expect(() => assertTransitionAllowed(from, to)).toThrow(DomainError);
    });
  }

  it("same-to-same is illegal for all statuses", () => {
    const all: IndentStatus[] = ["draft", "pending", "tender_required", "approved", "rejected", "closed"];
    for (const s of all) {
      expect(() => assertTransitionAllowed(s, s)).toThrow("INVALID_TRANSITION");
    }
  });
});

// ═══ Segregation of Duties ═══

describe("assertDistinctMakerChecker — SOD", () => {
  it("passes when maker and checker are different", () => {
    expect(() => assertDistinctMakerChecker("user-A", "user-B")).not.toThrow();
  });

  it("throws SOD_VIOLATION when same actor", () => {
    expect(() => assertDistinctMakerChecker("user-A", "user-A")).toThrow("SOD_VIOLATION");
  });

  it("passes when either is empty (no enforcement)", () => {
    expect(() => assertDistinctMakerChecker("", "user-B")).not.toThrow();
    expect(() => assertDistinctMakerChecker("user-A", "")).not.toThrow();
  });
});

// ═══ Indent Approval Gate ═══

describe("assertIndentApproved", () => {
  it("passes for approved status", () => {
    expect(() => assertIndentApproved("approved")).not.toThrow();
  });

  it("throws INDENT_NOT_APPROVED for non-approved", () => {
    for (const s of ["draft", "pending", "rejected", "closed", "tender_required"]) {
      expect(() => assertIndentApproved(s)).toThrow("INDENT_NOT_APPROVED");
    }
  });
});

// ═══ Validators ═══

describe("createIndentBody — indent creation validation", () => {
  const validItem = { itemCode: "ITM-001", description: "Office Chair", quantity: 5, unitPriceMinor: 500000 };
  const valid = { indentNo: "IND-2026-001", department: "Admin", purpose: "Annual procurement", items: [validItem] };

  it("accepts valid indent", () => {
    expect(createIndentBody.safeParse(valid).success).toBe(true);
  });

  it("rejects empty indentNo", () => {
    expect(createIndentBody.safeParse({ ...valid, indentNo: "" }).success).toBe(false);
  });

  it("rejects indentNo exceeding 64 chars", () => {
    expect(createIndentBody.safeParse({ ...valid, indentNo: "x".repeat(65) }).success).toBe(false);
  });

  it("rejects empty department", () => {
    expect(createIndentBody.safeParse({ ...valid, department: "" }).success).toBe(false);
  });

  it("rejects purpose less than 3 chars", () => {
    expect(createIndentBody.safeParse({ ...valid, purpose: "ab" }).success).toBe(false);
  });

  it("rejects empty items array", () => {
    expect(createIndentBody.safeParse({ ...valid, items: [] }).success).toBe(false);
  });

  it("rejects zero quantity in item", () => {
    expect(createIndentBody.safeParse({ ...valid, items: [{ ...validItem, quantity: 0 }] }).success).toBe(false);
  });

  it("rejects negative quantity", () => {
    expect(createIndentBody.safeParse({ ...valid, items: [{ ...validItem, quantity: -1 }] }).success).toBe(false);
  });

  it("rejects negative unitPriceMinor", () => {
    expect(createIndentBody.safeParse({ ...valid, items: [{ ...validItem, unitPriceMinor: -100 }] }).success).toBe(false);
  });

  it("accepts all valid procurementMode values", () => {
    for (const mode of ["direct_purchase", "gem", "limited_tender", "advertised_tender", "single_tender"]) {
      expect(createIndentBody.safeParse({ ...valid, procurementMode: mode }).success).toBe(true);
    }
  });

  it("rejects invalid procurementMode", () => {
    expect(createIndentBody.safeParse({ ...valid, procurementMode: "open_bid" }).success).toBe(false);
  });

  it("defaults item unit to 'nos'", () => {
    const noUnit = { itemCode: "X", description: "Y", quantity: 1, unitPriceMinor: 100 };
    const result = createIndentBody.safeParse({ ...valid, items: [noUnit] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items[0]?.unit).toBe("nos");
  });
});

describe("rejectIndentBody — rejection validation", () => {
  it("accepts valid reason", () => {
    expect(rejectIndentBody.safeParse({ reason: "Budget not available" }).success).toBe(true);
  });

  it("rejects empty reason", () => {
    expect(rejectIndentBody.safeParse({ reason: "" }).success).toBe(false);
  });

  it("rejects reason exceeding 500 chars", () => {
    expect(rejectIndentBody.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });
});

describe("approveIndentBody", () => {
  it("accepts empty body (notes optional)", () => {
    expect(approveIndentBody.safeParse({}).success).toBe(true);
  });

  it("rejects notes exceeding 500 chars", () => {
    expect(approveIndentBody.safeParse({ notes: "x".repeat(501) }).success).toBe(false);
  });
});

describe("idParam", () => {
  it("accepts UUID", () => expect(idParam.safeParse({ id: "10000000-aaaa-4000-8000-000000000001" }).success).toBe(true));
  it("rejects non-UUID", () => expect(idParam.safeParse({ id: "bad" }).success).toBe(false));
});
