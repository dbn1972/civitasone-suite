/**
 * D1 (CITIZEN-NOTICES-05) notice documentId and D2 (CITIZEN-RTI-DETAIL-06) first-appeal decision:
 * pure validator / mapper contracts (no DB).
 */
import { describe, it, expect } from "vitest";
import { createNoticeBody } from "../src/modules/engagement/validators.js";
import { toNoticeDto } from "../src/modules/engagement/mappers.js";
import { decideRtiAppealBody, RTI_APPEAL_OUTCOMES } from "../src/modules/rti/validators.js";
import { RTI_APPELLATE_ROLES } from "../src/modules/rti/domain.js";
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
