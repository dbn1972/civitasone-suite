/**
 * Legal Service — Domain Logic: Deep tests.
 *
 * Tests case disposal guards, notice response guards, and the limitations
 * domain (deadline computation, notification scheduling, expiry detection).
 *
 * Source: modules/cases/domain.ts, modules/notices/domain.ts, modules/limitations/domain.ts
 */
import { describe, it, expect } from "vitest";
import { assertCanDispose, DomainError as CaseDomainError } from "../src/modules/cases/domain.js";
import { assertCanRespond, DomainError as NoticeDomainError } from "../src/modules/notices/domain.js";
import { computeDeadline, scheduleNotifications, isExpired, LimitationDomainError } from "../src/modules/limitations/domain.js";

// ═══ Cases Domain ═══

describe("assertCanDispose — case disposal guard", () => {
  it("passes for pending", () => expect(() => assertCanDispose("pending")).not.toThrow());
  it("passes for appealed", () => expect(() => assertCanDispose("appealed")).not.toThrow());
  it("passes for stayed", () => expect(() => assertCanDispose("stayed")).not.toThrow());
  it("throws INVALID_STATUS for disposed", () => expect(() => assertCanDispose("disposed")).toThrow("INVALID_STATUS"));
  it("throws for filed", () => expect(() => assertCanDispose("filed")).toThrow(CaseDomainError));
  it("throws for closed", () => expect(() => assertCanDispose("closed")).toThrow(CaseDomainError));
});

// ═══ Notices Domain ═══

describe("assertCanRespond — notice response guard", () => {
  it("passes for open notices", () => expect(() => assertCanRespond("open")).not.toThrow());
  it("throws for responded", () => expect(() => assertCanRespond("responded")).toThrow("INVALID_STATUS"));
  it("throws for closed", () => expect(() => assertCanRespond("closed")).toThrow(NoticeDomainError));
  it("throws for expired", () => expect(() => assertCanRespond("expired")).toThrow(NoticeDomainError));
});

// ═══ Limitations Domain ═══

describe("computeDeadline — statutory deadline", () => {
  it("adds period days to start date", () => {
    const start = new Date("2026-07-01T00:00:00Z");
    const deadline = computeDeadline(start, 30);
    expect(deadline.toISOString().slice(0, 10)).toBe("2026-07-31");
  });

  it("crosses month boundary", () => {
    const start = new Date("2026-01-15T00:00:00Z");
    const deadline = computeDeadline(start, 30);
    expect(deadline.toISOString().slice(0, 10)).toBe("2026-02-14");
  });

  it("crosses year boundary", () => {
    const start = new Date("2026-12-01T00:00:00Z");
    const deadline = computeDeadline(start, 60);
    expect(deadline.toISOString().slice(0, 10)).toBe("2027-01-30");
  });

  it("throws INVALID_PERIOD for zero days", () => {
    expect(() => computeDeadline(new Date(), 0)).toThrow(LimitationDomainError);
  });

  it("throws INVALID_PERIOD for negative days", () => {
    expect(() => computeDeadline(new Date(), -10)).toThrow(LimitationDomainError);
  });
});

describe("scheduleNotifications — 30/15/7 day reminders", () => {
  const deadline = new Date("2026-08-30T00:00:00Z");

  it("returns all 3 notifications when current is well before deadline", () => {
    const current = new Date("2026-07-01T00:00:00Z");
    const result = scheduleNotifications(deadline, current);
    expect(result.at30d).toBeDefined();
    expect(result.at15d).toBeDefined();
    expect(result.at7d).toBeDefined();
  });

  it("omits past notifications", () => {
    // Current is Aug 20 — 30d (Jul 31) and 15d (Aug 15) are past
    const current = new Date("2026-08-20T00:00:00Z");
    const result = scheduleNotifications(deadline, current);
    expect(result.at30d).toBeUndefined();
    expect(result.at15d).toBeUndefined();
    expect(result.at7d).toBeDefined(); // Aug 23 is still future
  });

  it("returns empty when all notifications are past", () => {
    const current = new Date("2026-08-25T00:00:00Z"); // all past
    const result = scheduleNotifications(deadline, current);
    expect(result.at30d).toBeUndefined();
    expect(result.at15d).toBeUndefined();
    expect(result.at7d).toBeUndefined();
  });

  it("30d notification is 30 days before deadline", () => {
    const current = new Date("2026-07-01T00:00:00Z");
    const result = scheduleNotifications(deadline, current);
    expect(result.at30d?.toISOString().slice(0, 10)).toBe("2026-07-31");
  });
});

describe("isExpired — deadline breach", () => {
  const deadline = new Date("2026-08-15T00:00:00Z");

  it("false when before deadline", () => {
    expect(isExpired(deadline, new Date("2026-08-14T23:59:59Z"))).toBe(false);
  });

  it("true at exact deadline", () => {
    expect(isExpired(deadline, new Date("2026-08-15T00:00:00Z"))).toBe(true);
  });

  it("true after deadline", () => {
    expect(isExpired(deadline, new Date("2026-08-16T00:00:00Z"))).toBe(true);
  });
});
