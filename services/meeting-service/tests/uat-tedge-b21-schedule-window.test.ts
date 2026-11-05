/**
 * UAT T-EDGE bundle 21 (TE-07, M04): a new meeting scheduled in 2001 was accepted. The IST day of
 * scheduledAt must be at most 1 year back and 5 years ahead; real dates and an offset were already
 * required (M01-M03 passed). Schema-level: the create route parses with this schema before queueing.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createMeetingSchema } from "../src/modules/meeting-core/validators.js";

const base = { title: "UAT-TEDGE b21", type: "committee", durationMinutes: 30, chairpersonId: randomUUID(), secretaryId: randomUUID() };
const parse = (scheduledAt: string) => createMeetingSchema.safeParse({ ...base, scheduledAt });
const codeOf = (scheduledAt: string) => {
  const r = parse(scheduledAt);
  return r.success ? undefined : (r.error.issues[0] as { params?: { code?: string } }).params?.code;
};
const isoInDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "+00:00");

describe("meeting scheduledAt window (TE-07)", () => {
  it("M04 2001-01-01 -> DATE_TOO_EARLY", () => {
    expect(codeOf("2001-01-01T10:00:00+05:30")).toBe("DATE_TOO_EARLY");
  });
  it("10 years ahead -> DATE_TOO_LATE", () => {
    expect(codeOf(isoInDays(3650))).toBe("DATE_TOO_LATE");
  });
  it("next month and last month are accepted", () => {
    expect(parse(isoInDays(30)).success).toBe(true);
    expect(parse(isoInDays(-30)).success).toBe(true);
  });
  it("M01 29 Feb in a non-leap year is still refused", () => {
    expect(parse("2027-02-29T10:00:00+05:30").success).toBe(false);
  });
});
