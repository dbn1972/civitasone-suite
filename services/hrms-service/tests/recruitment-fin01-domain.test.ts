/** Pure domain helpers added by fin-recruitment-01. */
import { describe, it, expect } from "vitest";
import { maskEmail, maskMobile } from "../src/modules/recruitment/pii-mask.js";
import { HORIZONTAL_CATEGORIES, validateHorizontal } from "../src/modules/recruitment/reservation-domain.js";
import { buildAdmitCard, rollNumber, admitCardBlockedReason, DEFAULT_ADMIT_CARD_INSTRUCTIONS } from "../src/modules/recruitment/admit-card.js";
import { updateSettingsBody } from "../src/modules/recruitment/settings-routes.js";
import { revealBody } from "../src/modules/recruitment/pii-reveal-routes.js";

describe("pii-mask", () => {
  it("masks an email to first letters + tld and is idempotent", () => {
    expect(maskEmail("asha.verma@dept.gov.in")).toBe("a***@d***.in");
    expect(maskEmail(maskEmail("asha.verma@dept.gov.in"))).toBe("a***@d***.in");
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail(null)).toBeNull();
  });
  it("keeps only the last four digits of a mobile number", () => {
    expect(maskMobile("9876543210")).toBe("******3210");
    expect(maskMobile("98 76 54 32 10")).toBe("******3210");
    expect(maskMobile("123")).toBe("****");
    expect(maskMobile(undefined)).toBeNull();
  });
});

describe("validateHorizontal", () => {
  it("knows PwBD / ex-servicemen / women", () => {
    expect([...HORIZONTAL_CATEGORIES]).toEqual(["PWBD", "EXSM", "WOMEN"]);
  });
  it("accepts counts up to the total and rejects negatives, fractions and overflow", () => {
    expect(validateHorizontal({ PWBD: 1, EXSM: 10 }, 10)).toEqual([]);
    expect(validateHorizontal({ PWBD: 11 }, 10)).toHaveLength(1);
    expect(validateHorizontal({ WOMEN: -1 }, 10)).toHaveLength(1);
    expect(validateHorizontal({ EXSM: 1.5 }, 10)).toHaveLength(1);
    expect(validateHorizontal({}, 10)).toEqual([]);
  });
});

describe("admit card", () => {
  const sid = "44444444-0001-4000-8000-000000000004";
  const aid = "33333333-0001-4000-8000-000000000003";
  it("derives a stable roll number from the schedule and attempt ids", () => {
    expect(rollNumber(sid, aid)).toBe("4444-333333");
    expect(rollNumber(sid, aid)).toBe(rollNumber(sid, aid));
    expect(rollNumber(sid, "99999999-0001-4000-8000-000000000009")).not.toBe(rollNumber(sid, aid));
  });
  it("builds the card with ISO times and the default instructions", () => {
    const c = buildAdmitCard({
      attemptId: aid, scheduleId: sid, attemptStatus: "assigned", scheduleStatus: "scheduled", candidateName: "Asha Verma", applicationNo: null,
      scheduleTitle: "Written Test", mode: "online", windowStart: new Date("2026-10-20T04:30:00Z"), windowEnd: new Date("2026-10-20T07:30:00Z"), slotLabel: null, identityVerified: true,
    });
    expect(c.windowStart).toBe("2026-10-20T04:30:00.000Z");
    expect(c.instructions).toEqual([...DEFAULT_ADMIT_CARD_INSTRUCTIONS]);
  });
  it("blocks a cancelled sitting and withdrawn / superseded attempts", () => {
    expect(admitCardBlockedReason("cancelled", "assigned")).toMatch(/cancelled/);
    expect(admitCardBlockedReason("scheduled", "withdrawn")).toMatch(/withdrawn/);
    expect(admitCardBlockedReason("scheduled", "assigned")).toBeNull();
  });
});

describe("request schemas", () => {
  it("settings: https/absolute-path emblem only, at least one field, no unknown keys", () => {
    expect(updateSettingsBody.safeParse({ emblemUrl: "https://x.gov.in/e.png" }).success).toBe(true);
    expect(updateSettingsBody.safeParse({ emblemUrl: "/static/emblem.svg" }).success).toBe(true);
    expect(updateSettingsBody.safeParse({ emblemUrl: "//evil.example/e.png" }).success).toBe(false);
    expect(updateSettingsBody.safeParse({ emblemUrl: "data:image/png;base64,AAAA" }).success).toBe(false);
    expect(updateSettingsBody.safeParse({}).success).toBe(false);
    expect(updateSettingsBody.safeParse({ organisationName: "X", surprise: 1 }).success).toBe(false);
    expect(updateSettingsBody.safeParse({ organisationName: null }).success).toBe(true);
  });
  it("reveal: reason of at least 5 characters; scope defaults to inbox", () => {
    expect(revealBody.parse({ reason: "  call back  " })).toEqual({ reason: "call back", scope: "inbox" });
    expect(revealBody.safeParse({ reason: "no" }).success).toBe(false);
    expect(revealBody.safeParse({ reason: "valid reason", scope: "everywhere" }).success).toBe(false);
  });
});
