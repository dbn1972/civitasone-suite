/**
 * D1 (CITIZEN-NOTICES-05) notice documentId and D2 (CITIZEN-RTI-DETAIL-06) first-appeal decision:
 * pure validator / mapper contracts (no DB).
 */
import { describe, it, expect } from "vitest";
import { createNoticeBody } from "../src/modules/engagement/validators.js";
import { toNoticeDto } from "../src/modules/engagement/mappers.js";
import { decideRtiAppealBody, RTI_APPEAL_OUTCOMES, istToday } from "../src/modules/rti/validators.js";
import { RTI_APPELLATE_ROLES, appealDecisionConflict, resolveResponder } from "../src/modules/rti/domain.js";
import type { CitizenNoticeRow } from "../src/modules/engagement/schema.js";

describe("D1 notice documentId", () => {
  const base = { subject: "Public hearing on ward 14 drainage works", department: "Municipal Engineering" };
  it("accepts an optional document-service uuid", () => {
    const r = createNoticeBody.safeParse({ ...base, documentId: "5b0f3d1e-6c2a-4a58-9b7d-2f8f0c3e9a11" });
    expect(r.success).toBe(true);
  });
  it("rejects a non-uuid documentId and accepts none", () => {
    expect(createNoticeBody.safeParse({ ...base, documentId: "not-a-uuid" }).success).toBe(false);
    expect(createNoticeBody.safeParse(base).success).toBe(true);
  });
  it("maps documentId (null when absent) onto the wire DTO", () => {
    const row = {
      id: "a", tenantId: "t", noticeNo: "NTC-2026-000001", subject: "s", body: "", department: "d", noticeType: "general",
      documentId: "5b0f3d1e-6c2a-4a58-9b7d-2f8f0c3e9a11", status: "published", publishedAt: null, expiresAt: null,
      createdAt: new Date(), updatedAt: new Date(), createdBy: "u", updatedBy: "u", version: 1,
    } as CitizenNoticeRow;
    expect(toNoticeDto(row).documentId).toBe("5b0f3d1e-6c2a-4a58-9b7d-2f8f0c3e9a11");
    expect(toNoticeDto({ ...row, documentId: null }).documentId).toBeNull();
  });
});

describe("D2 first-appeal decision", () => {
  const ok = { outcome: "partly_allowed", decisionDate: "2026-11-20", hearingDate: "2026-11-12", reason: "Part of the information is exempt under s.8(1)(d); the rest is to be furnished within 10 days." };
  it("allows exactly allowed / partly_allowed / rejected / remanded", () => {
    expect([...RTI_APPEAL_OUTCOMES]).toEqual(["allowed", "partly_allowed", "rejected", "remanded"]);
    for (const outcome of RTI_APPEAL_OUTCOMES) expect(decideRtiAppealBody.safeParse({ ...ok, outcome }).success).toBe(true);
    expect(decideRtiAppealBody.safeParse({ ...ok, outcome: "dismissed" }).success).toBe(false);
  });
  it("requires reasons and a real, non-future decision date", () => {
    expect(decideRtiAppealBody.safeParse({ ...ok, reason: "" }).success).toBe(false);
    expect(decideRtiAppealBody.safeParse({ ...ok, decisionDate: "2026-02-30" }).success).toBe(false);
    expect(decideRtiAppealBody.safeParse({ ...ok, decisionDate: "2999-01-01", hearingDate: undefined }).success).toBe(false);
  });
  it("rejects a hearing date after the decision date; hearing date is optional", () => {
    expect(decideRtiAppealBody.safeParse({ ...ok, hearingDate: "2026-11-25" }).success).toBe(false);
    expect(decideRtiAppealBody.safeParse({ ...ok, hearingDate: undefined }).success).toBe(true);
  });
  it("is gated to the rti_appellate role (not the CPIO officer tier)", () => {
    expect(RTI_APPELLATE_ROLES).toContain("rti_appellate");
    expect(RTI_APPELLATE_ROLES).not.toContain("citizen_officer");
    expect(RTI_APPELLATE_ROLES).not.toContain("citizen_admin");
  });
});

describe("D2 follow-up: separation of duties", () => {
  const appellate = "7d2c9a10-3b5e-4f1a-8c66-0a1b2c3d4e5f";
  const cpioUser = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const delegate = "11111111-2222-4333-8444-555555555555";
  it("blocks an actor who recorded a response", () => {
    expect(appealDecisionConflict({ actorId: delegate, responderIds: [delegate] })).toBe("RESPONDER");
  });
  it("blocks the ASSIGNED CPIO even when a delegate uploaded the response", () => {
    expect(appealDecisionConflict({ actorId: cpioUser, responderIds: [delegate], assignedCpioUserId: cpioUser })).toBe("ASSIGNED_CPIO");
  });
  it("allows an independent appellate officer; an unmapped CPIO entry never blocks", () => {
    expect(appealDecisionConflict({ actorId: appellate, responderIds: [delegate], assignedCpioUserId: cpioUser })).toBeNull();
    expect(appealDecisionConflict({ actorId: appellate, responderIds: [], assignedCpioUserId: null })).toBeNull();
  });
  it("estab-event response records the human responder carried in the payload, else the envelope actor", () => {
    const system = "99999999-9999-4999-8999-999999999999";
    expect(resolveResponder(cpioUser, system)).toBe(cpioUser);
    expect(resolveResponder(undefined, system)).toBe(system);
    expect(resolveResponder("not-a-uuid", system)).toBe(system);
    // the human CPIO recorded via the event is then blocked from deciding
    expect(appealDecisionConflict({ actorId: cpioUser, responderIds: [resolveResponder(cpioUser, system)] })).toBe("RESPONDER");
  });
});

describe("D2 follow-up: IST decision date", () => {
  it("istToday rolls over at 18:30 UTC (00:00 IST)", () => {
    expect(istToday(new Date("2026-11-26T18:29:00Z"))).toBe("2026-11-26");
    expect(istToday(new Date("2026-11-26T18:31:00Z"))).toBe("2026-11-27");
  });
  it("accepts today's IST date at 00:30 IST (still the previous UTC day)", () => {
    const base = { outcome: "allowed", reason: "Information to be furnished." };
    const today = istToday();
    expect(decideRtiAppealBody.safeParse({ ...base, decisionDate: today }).success).toBe(true);
  });
});
