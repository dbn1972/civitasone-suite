/**
 * DM-002 — unit tests for document type / mandatory-document / expiry logic.
 *
 * Expiry boundaries get the most attention: expiring today, expired exactly
 * now, no expiry set, the warning-window edges, and timezone correctness (every
 * stored timestamp is `timestamptz`, so an offset-bearing instant must classify
 * identically to its UTC form).
 */
import { describe, it, expect } from "vitest";
import { HttpError } from "../src/shared/context.js";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_STATUSES,
  daysUntil,
  classifyExpiry,
  evaluateCompliance,
  assertExpiryPresentWhenRequired,
  assertExpiryAfterIssue,
  assertExtensionAllowed,
  assertTypeActive,
  assertVersionMatch,
  type DocumentInput,
  type RequirementInput,
} from "../src/modules/uploads/doc-domain.js";

function expectHttpError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
    expect((err as HttpError).code).toBe(code);
    return;
  }
  throw new Error(`expected an HttpError ${status} ${code}, nothing was thrown`);
}

const DAY = 24 * 60 * 60_000;
const NOW = new Date("2026-07-01T12:00:00.000Z");
const at = (ms: number): Date => new Date(NOW.getTime() + ms);

describe("DM-002 constants", () => {
  it("mirrors the category and status CHECK constraints", () => {
    expect(DOCUMENT_CATEGORIES).toEqual(["resume", "attachment", "document", "photo", "certificate", "licence"]);
    expect(DOCUMENT_STATUSES).toEqual(["active", "expiring", "expired", "superseded"]);
  });
});

describe("daysUntil", () => {
  it("is 0 for an expiry later the same day", () => {
    expect(daysUntil(at(6 * 60 * 60_000), NOW)).toBe(0);
  });

  it("is 0 for an expiry exactly now", () => {
    expect(daysUntil(NOW, NOW)).toBe(0);
  });

  it("counts whole days ahead, flooring a partial day", () => {
    expect(daysUntil(at(30 * DAY), NOW)).toBe(30);
    expect(daysUntil(at(30 * DAY + 6 * 60 * 60_000), NOW)).toBe(30);
  });

  it("goes negative once past", () => {
    expect(daysUntil(at(-1 * DAY), NOW)).toBe(-1);
    expect(daysUntil(at(-1), NOW)).toBe(-1);
  });

  it("accepts an ISO string as well as a Date", () => {
    expect(daysUntil(at(5 * DAY).toISOString(), NOW)).toBe(5);
  });

  it("is offset-agnostic: the same instant in IST gives the same answer", () => {
    const utc = "2026-07-11T12:00:00.000Z";
    const ist = "2026-07-11T17:30:00.000+05:30";
    expect(daysUntil(ist, NOW)).toBe(daysUntil(utc, NOW));
  });
});

describe("classifyExpiry", () => {
  it("is active when no expiry is set", () => {
    expect(classifyExpiry("active", null, 30, NOW)).toBe("active");
    expect(classifyExpiry("active", undefined, 30, NOW)).toBe("active");
  });

  it("keeps superseded regardless of the dates — it is a manual state", () => {
    expect(classifyExpiry("superseded", at(-100 * DAY), 30, NOW)).toBe("superseded");
    expect(classifyExpiry("superseded", null, 30, NOW)).toBe("superseded");
    expect(classifyExpiry("superseded", at(100 * DAY), 30, NOW)).toBe("superseded");
  });

  it("is expired exactly at the expiry instant", () => {
    expect(classifyExpiry("active", NOW, 30, NOW)).toBe("expired");
  });

  it("is expired one millisecond past the expiry instant", () => {
    expect(classifyExpiry("active", at(-1), 30, NOW)).toBe("expired");
  });

  it("is expired well past the expiry", () => {
    expect(classifyExpiry("active", at(-90 * DAY), 30, NOW)).toBe("expired");
  });

  it("is EXPIRING for a document expiring later today", () => {
    expect(classifyExpiry("active", at(1), 30, NOW)).toBe("expiring");
    expect(classifyExpiry("active", at(6 * 60 * 60_000), 30, NOW)).toBe("expiring");
  });

  it("is expiring exactly at the warning-window edge", () => {
    expect(classifyExpiry("active", at(30 * DAY), 30, NOW)).toBe("expiring");
  });

  it("is still expiring a few hours past the window edge, because days are floored", () => {
    expect(classifyExpiry("active", at(30 * DAY + 60 * 60_000), 30, NOW)).toBe("expiring");
  });

  it("is active a full day beyond the warning window", () => {
    expect(classifyExpiry("active", at(31 * DAY), 30, NOW)).toBe("active");
  });

  it("honours a narrow warning window", () => {
    expect(classifyExpiry("active", at(5 * DAY), 3, NOW)).toBe("active");
    expect(classifyExpiry("active", at(3 * DAY), 3, NOW)).toBe("expiring");
  });

  it("honours a wide warning window", () => {
    expect(classifyExpiry("active", at(300 * DAY), 365, NOW)).toBe("expiring");
  });

  it("classifies an offset-bearing timestamp identically to its UTC form", () => {
    const utc = classifyExpiry("active", "2026-07-11T12:00:00.000Z", 30, NOW);
    const ist = classifyExpiry("active", "2026-07-11T17:30:00.000+05:30", 30, NOW);
    expect(ist).toBe(utc);
    expect(ist).toBe("expiring");
  });

  it("does not flip a decision across a timezone boundary near midnight", () => {
    // 2026-07-31T23:00Z is 2026-08-01T04:30 IST; the instant is what matters.
    const now = new Date("2026-07-31T22:00:00.000Z");
    expect(classifyExpiry("active", "2026-07-31T23:00:00.000Z", 0, now)).toBe("expiring");
    expect(classifyExpiry("active", "2026-08-01T04:30:00.000+05:30", 0, now)).toBe("expiring");
  });

  it("treats an unparseable expiry as active rather than throwing", () => {
    expect(classifyExpiry("active", "not-a-date", 30, NOW)).toBe("active");
  });

  it("re-classifies a document already marked expiring", () => {
    expect(classifyExpiry("expiring", at(-1 * DAY), 30, NOW)).toBe("expired");
    expect(classifyExpiry("expiring", at(90 * DAY), 30, NOW)).toBe("active");
  });

  it("accepts a string expiry as well as a Date", () => {
    expect(classifyExpiry("active", at(2 * DAY).toISOString(), 30, NOW)).toBe("expiring");
  });

  it("defaults `now` to the current clock", () => {
    expect(classifyExpiry("active", new Date(Date.now() - 1000), 30)).toBe("expired");
  });
});

describe("evaluateCompliance", () => {
  const req = (documentTypeCode: string, mandatory = true): RequirementInput => ({ documentTypeCode, mandatory });
  const doc = (documentTypeCode: string, expiresAt: Date | string | null, status = "active"): DocumentInput =>
    ({ documentTypeCode, status, expiresAt });

  it("reports a requirement with no document as missing and not compliant", () => {
    const r = evaluateCompliance([req("pan")], [], {}, NOW);
    expect(r.lines).toEqual([{ documentTypeCode: "pan", mandatory: true, outcome: "missing", daysRemaining: null }]);
    expect(r.compliant).toBe(false);
    expect(r.missingCount).toBe(1);
  });

  it("stays compliant when only an OPTIONAL requirement is missing", () => {
    const r = evaluateCompliance([req("nice-to-have", false)], [], {}, NOW);
    expect(r.compliant).toBe(true);
    expect(r.missingCount).toBe(1);
  });

  it("reports a document with no expiry as satisfied", () => {
    const r = evaluateCompliance([req("degree")], [doc("degree", null)], {}, NOW);
    expect(r.lines[0]).toMatchObject({ outcome: "satisfied", daysRemaining: null });
    expect(r.compliant).toBe(true);
  });

  it("reports a document far from expiry as satisfied with a day count", () => {
    const r = evaluateCompliance([req("licence")], [doc("licence", at(200 * DAY))], { licence: 30 }, NOW);
    expect(r.lines[0]).toMatchObject({ outcome: "satisfied", daysRemaining: 200 });
  });

  it("an EXPIRING mandatory document is compliant but flagged", () => {
    const r = evaluateCompliance([req("licence")], [doc("licence", at(10 * DAY))], { licence: 30 }, NOW);
    expect(r.lines[0]).toMatchObject({ outcome: "expiring", daysRemaining: 10 });
    expect(r.compliant).toBe(true);
    expect(r.expiringCount).toBe(1);
  });

  it("an EXPIRED mandatory document breaks compliance", () => {
    const r = evaluateCompliance([req("licence")], [doc("licence", at(-1 * DAY))], { licence: 30 }, NOW);
    expect(r.lines[0]).toMatchObject({ outcome: "expired", daysRemaining: -1 });
    expect(r.compliant).toBe(false);
    expect(r.expiredCount).toBe(1);
  });

  it("an expired OPTIONAL document does not break compliance", () => {
    const r = evaluateCompliance([req("optional", false)], [doc("optional", at(-1 * DAY))], {}, NOW);
    expect(r.compliant).toBe(true);
    expect(r.expiredCount).toBe(1);
  });

  it("prefers an active document over an expiring one of the same type", () => {
    const r = evaluateCompliance(
      [req("licence")],
      [doc("licence", at(2 * DAY)), doc("licence", at(400 * DAY))],
      { licence: 30 }, NOW,
    );
    expect(r.lines[0]?.outcome).toBe("satisfied");
    expect(r.lines[0]?.daysRemaining).toBe(400);
  });

  it("prefers an expiring document over an expired one of the same type", () => {
    const r = evaluateCompliance(
      [req("licence")],
      [doc("licence", at(-10 * DAY)), doc("licence", at(5 * DAY))],
      { licence: 30 }, NOW,
    );
    expect(r.lines[0]?.outcome).toBe("expiring");
    expect(r.lines[0]?.daysRemaining).toBe(5);
  });

  it("ignores superseded documents — a context holding only one is missing", () => {
    const r = evaluateCompliance([req("pan")], [doc("pan", null, "superseded")], {}, NOW);
    expect(r.lines[0]?.outcome).toBe("missing");
    expect(r.compliant).toBe(false);
  });

  it("ignores documents of an unrelated type", () => {
    const r = evaluateCompliance([req("pan")], [doc("aadhaar", null)], {}, NOW);
    expect(r.lines[0]?.outcome).toBe("missing");
  });

  it("uses the per-type warning window, not a single global one", () => {
    const held = [doc("short", at(10 * DAY)), doc("long", at(10 * DAY))];
    const r = evaluateCompliance([req("short"), req("long")], held, { short: 5, long: 60 }, NOW);
    expect(r.lines.find((l) => l.documentTypeCode === "short")?.outcome).toBe("satisfied");
    expect(r.lines.find((l) => l.documentTypeCode === "long")?.outcome).toBe("expiring");
  });

  it("falls back to a 30-day window when the type has no configured value", () => {
    const r = evaluateCompliance([req("unknown")], [doc("unknown", at(20 * DAY))], {}, NOW);
    expect(r.lines[0]?.outcome).toBe("expiring");
  });

  it("summarises a mixed context correctly", () => {
    const r = evaluateCompliance(
      [req("a"), req("b"), req("c"), req("d", false)],
      [doc("a", null), doc("b", at(5 * DAY)), doc("c", at(-5 * DAY))],
      { a: 30, b: 30, c: 30 }, NOW,
    );
    expect(r.missingCount).toBe(1);
    expect(r.expiringCount).toBe(1);
    expect(r.expiredCount).toBe(1);
    expect(r.compliant).toBe(false);
  });

  it("is compliant with no requirements at all", () => {
    const r = evaluateCompliance([], [], {}, NOW);
    expect(r).toEqual({ lines: [], compliant: true, missingCount: 0, expiredCount: 0, expiringCount: 0 });
  });

  it("preserves requirement order in the report lines", () => {
    const r = evaluateCompliance([req("z"), req("a")], [], {}, NOW);
    expect(r.lines.map((l) => l.documentTypeCode)).toEqual(["z", "a"]);
  });

  it("defaults `now` to the current clock", () => {
    const r = evaluateCompliance([req("x")], [doc("x", new Date(Date.now() - 1000))], { x: 30 });
    expect(r.lines[0]?.outcome).toBe("expired");
  });
});

describe("assertExpiryPresentWhenRequired", () => {
  it("passes when the type does not require an expiry", () => {
    expect(() => assertExpiryPresentWhenRequired(false, null)).not.toThrow();
    expect(() => assertExpiryPresentWhenRequired(false, undefined)).not.toThrow();
  });

  it("passes when the type requires one and it is supplied", () => {
    expect(() => assertExpiryPresentWhenRequired(true, "2027-01-01T00:00:00.000Z")).not.toThrow();
  });

  it("422 EXPIRY_REQUIRED when the type requires one and it is absent", () => {
    expectHttpError(() => assertExpiryPresentWhenRequired(true, undefined), 422, "EXPIRY_REQUIRED");
    expectHttpError(() => assertExpiryPresentWhenRequired(true, null), 422, "EXPIRY_REQUIRED");
  });
});

describe("assertExpiryAfterIssue", () => {
  it("passes when either date is absent", () => {
    expect(() => assertExpiryAfterIssue(undefined, "2027-01-01T00:00:00.000Z")).not.toThrow();
    expect(() => assertExpiryAfterIssue("2026-01-01T00:00:00.000Z", null)).not.toThrow();
    expect(() => assertExpiryAfterIssue(null, null)).not.toThrow();
  });

  it("passes when expiry is after issue", () => {
    expect(() => assertExpiryAfterIssue("2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z")).not.toThrow();
  });

  it("422 INVALID_EXPIRY when expiry equals issue", () => {
    expectHttpError(
      () => assertExpiryAfterIssue("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      422, "INVALID_EXPIRY",
    );
  });

  it("422 INVALID_EXPIRY when expiry precedes issue", () => {
    expectHttpError(
      () => assertExpiryAfterIssue("2027-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      422, "INVALID_EXPIRY",
    );
  });

  it("compares instants, not wall clocks, across offsets", () => {
    // 2026-01-01T05:30+05:30 IS 2026-01-01T00:00Z — equal, so it must fail.
    expectHttpError(
      () => assertExpiryAfterIssue("2026-01-01T00:00:00.000Z", "2026-01-01T05:30:00.000+05:30"),
      422, "INVALID_EXPIRY",
    );
  });
});

describe("assertExtensionAllowed", () => {
  it("permits anything when no restriction is configured", () => {
    expect(() => assertExtensionAllowed("tenant/a/file.exe", [])).not.toThrow();
  });

  it("permits an allowed extension", () => {
    expect(() => assertExtensionAllowed("tenant/a/file.pdf", ["pdf", "jpg"])).not.toThrow();
  });

  it("is case-insensitive on both the key and the allow-list", () => {
    expect(() => assertExtensionAllowed("tenant/a/FILE.PDF", ["pdf"])).not.toThrow();
    expect(() => assertExtensionAllowed("tenant/a/file.pdf", ["PDF"])).not.toThrow();
  });

  it("422 EXTENSION_NOT_ALLOWED for a disallowed extension", () => {
    expectHttpError(() => assertExtensionAllowed("tenant/a/file.exe", ["pdf"]), 422, "EXTENSION_NOT_ALLOWED");
  });

  it("422 when the key has no extension at all", () => {
    expectHttpError(() => assertExtensionAllowed("tenant/a/file", ["pdf"]), 422, "EXTENSION_NOT_ALLOWED");
  });

  it("uses the LAST dotted segment, so a double extension cannot smuggle a type", () => {
    expectHttpError(() => assertExtensionAllowed("tenant/a/file.pdf.exe", ["pdf"]), 422, "EXTENSION_NOT_ALLOWED");
  });
});

describe("DM-002 guards", () => {
  it("only an active type may be used", () => {
    expect(() => assertTypeActive("active")).not.toThrow();
    expectHttpError(() => assertTypeActive("retired"), 422, "DOCUMENT_TYPE_RETIRED");
  });

  it("optimistic lock: absent expectation passes, match passes, mismatch is 409", () => {
    expect(() => assertVersionMatch(5, undefined)).not.toThrow();
    expect(() => assertVersionMatch(5, 5)).not.toThrow();
    expectHttpError(() => assertVersionMatch(5, 4), 409, "VERSION_CONFLICT");
  });
});
