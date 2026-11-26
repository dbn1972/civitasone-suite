import { describe, it, expect } from "vitest";
import { istToday } from "@civitasone/schemas/validators";
import { promotionBody, createPromotionBody, promotionLatestEffectiveDate, PROMOTION_MAX_FUTURE_YEARS } from "./validators.js";

const FROM = "11111111-1111-4111-8111-111111111111";
const TO = "22222222-2222-4222-8222-222222222222";
const EMP = "33333333-3333-4333-8333-333333333333";

describe("GAP-HR-PROMOTION-05 -- promotion effective-date window (owner decision)", () => {
  it("the latest accepted date is today (IST) + 3 years, same month and day", () => {
    expect(PROMOTION_MAX_FUTURE_YEARS).toBe(3);
    expect(promotionLatestEffectiveDate("2026-11-26")).toBe("2029-11-26");
  });

  it("accepts a back-dated order (no lower bound)", () => {
    expect(promotionBody.safeParse({ fromDesigId: FROM, toDesigId: TO, effectiveDate: "2019-04-01" }).success).toBe(true);
  });

  it("accepts the last allowed day and refuses the day after it", () => {
    const last = promotionLatestEffectiveDate(istToday());
    expect(promotionBody.safeParse({ fromDesigId: FROM, toDesigId: TO, effectiveDate: last }).success).toBe(true);
    const next = `${Number(last.slice(0, 4)) + 1}${last.slice(4)}`;
    const refused = promotionBody.safeParse({ fromDesigId: FROM, toDesigId: TO, effectiveDate: next });
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toContain("3 years");
  });

  it("the create-promotion body enforces the same window", () => {
    const far = `${Number(istToday().slice(0, 4)) + 4}-01-01`;
    expect(createPromotionBody.safeParse({ employeeId: EMP, fromDesigId: FROM, toDesigId: TO, effectiveDate: far }).success).toBe(false);
  });
});
