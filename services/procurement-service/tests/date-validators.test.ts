/**
 * Route-level date validation: a malformed date string must be rejected with a
 * 400 at the boundary, never reach a DATE column in the consumer (poison
 * message) or be compared as a raw string.
 */
import { describe, it, expect } from "vitest";
import { dispatchBody } from "../src/modules/po/validators.js";
import { createTenderBody } from "../src/modules/tender/validators.js";

const BASE_TENDER = { title: "Open tender", type: "open", estimatedMinor: 1000, bidClosingDate: "2999-01-01" };

describe("dispatchBody.expectedDelivery", () => {
  it("accepts a real YYYY-MM-DD date and an omitted value", () => {
    expect(dispatchBody.safeParse({ expectedDelivery: "2026-07-15" }).success).toBe(true);
    expect(dispatchBody.safeParse({}).success).toBe(true);
  });
  it.each(["tomorrow", "15/07/2026", "2026-7-5", "2026-02-30", "2026-13-01", "2026-07-15T00:00:00Z", ""])(
    "rejects %j",
    (v) => {
      expect(dispatchBody.safeParse({ expectedDelivery: v }).success).toBe(false);
    },
  );
});

describe("createTenderBody.openingDate", () => {
  it("accepts a real YYYY-MM-DD date and an omitted value", () => {
    expect(createTenderBody.safeParse({ ...BASE_TENDER, openingDate: "2999-01-15" }).success).toBe(true);
    expect(createTenderBody.safeParse(BASE_TENDER).success).toBe(true);
  });
  it.each(["next week", "2999-02-30", "01-01-2999", "2999-01-15 10:00"])("rejects %j", (v) => {
    expect(createTenderBody.safeParse({ ...BASE_TENDER, openingDate: v }).success).toBe(false);
  });
});
