/**
 * meeting-service — tenure-expiry worker tests (Req 2.4).
 *
 * Covers the two behaviours the scheduled worker is responsible for:
 *   • Tenure-window detection — active memberships expiring within the 30-day advance-
 *     notice window emit `committee.tenure_expiring` (and only those).
 *   • Expiry transition — memberships on/past their tenure_end are flipped to `expired`
 *     and emit `committee.member_expired`.
 *
 * The pure decision logic (`classifyTenure`, `planTenureActions`) is exercised directly;
 * the runner (`runTenureExpiryWorker`) is driven through in-memory ports so the full
 * scan → plan → apply orchestration is verified without a database.
 *
 * _Requirements: 2.4_
 */
import { describe, expect, it } from "vitest";
import {
  classifyTenure,
  planTenureActions,
  runTenureExpiryWorker,
  addDaysIso,
  toIsoDate,
  DEFAULT_ADVANCE_NOTICE_DAYS,
  type MembershipRow,
} from "../src/workers/tenure-expiry.js";

const TODAY = "2026-06-15";

const row = (over: Partial<MembershipRow> = {}): MembershipRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  committeeId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  memberId: "mmmmmmmm-mmmm-mmmm-mmmm-mmmmmmmmmmmm",
  tenureEnd: TODAY,
  version: 1,
  status: "active",
  ...over,
});

describe("classifyTenure — tenure-window detection (Req 2.4)", () => {
  it("marks the exact tenure_end date as expired", () => {
    expect(classifyTenure(TODAY, TODAY)).toBe("expired");
  });

  it("marks a past tenure_end as expired (missed-run self-heal)", () => {
    expect(classifyTenure("2026-06-01", TODAY)).toBe("expired");
  });

  it("flags a tenure ending tomorrow as expiring", () => {
    expect(classifyTenure(addDaysIso(TODAY, 1), TODAY)).toBe("expiring");
  });

  it("flags the far edge of the 30-day window as expiring", () => {
    expect(classifyTenure(addDaysIso(TODAY, DEFAULT_ADVANCE_NOTICE_DAYS), TODAY)).toBe("expiring");
  });

  it("does not flag a tenure just beyond the window", () => {
    expect(classifyTenure(addDaysIso(TODAY, DEFAULT_ADVANCE_NOTICE_DAYS + 1), TODAY)).toBe("none");
  });

  it("never flags an open-ended tenure (null)", () => {
    expect(classifyTenure(null, TODAY)).toBe("none");
  });

  it("honours a custom advance-notice window", () => {
    expect(classifyTenure(addDaysIso(TODAY, 45), TODAY, 60)).toBe("expiring");
    expect(classifyTenure(addDaysIso(TODAY, 45), TODAY, 30)).toBe("none");
  });
});

describe("planTenureActions — partition into expiries + notices", () => {
  it("routes each membership to the correct bucket", () => {
    const rows = [
      row({ id: "expired-past", tenureEnd: "2026-05-01" }),
      row({ id: "expired-today", tenureEnd: TODAY }),
      row({ id: "expiring-soon", tenureEnd: addDaysIso(TODAY, 10) }),
      row({ id: "far-future", tenureEnd: addDaysIso(TODAY, 90) }),
      row({ id: "open-ended", tenureEnd: null as unknown as string }),
    ];
    const plan = planTenureActions(rows, TODAY);

    expect(plan.expiries.map((r) => r.id)).toEqual(["expired-past", "expired-today"]);
    expect(plan.expiringNotices.map((r) => r.id)).toEqual(["expiring-soon"]);
  });

  it("returns empty buckets for an empty scan", () => {
    expect(planTenureActions([], TODAY)).toEqual({ expiries: [], expiringNotices: [] });
  });
});

describe("runTenureExpiryWorker — scan → plan → apply orchestration (Req 2.4)", () => {
  it("expires due memberships and notifies expiring ones, exactly once each", async () => {
    const now = new Date(`${TODAY}T03:00:00Z`);
    const scanned = [
      row({ id: "due", tenureEnd: TODAY }),
      row({ id: "soon", tenureEnd: addDaysIso(TODAY, 5) }),
      row({ id: "later", tenureEnd: addDaysIso(TODAY, 120) }), // must not be returned by a correct scan
    ];

    const expired: string[] = [];
    const notified: string[] = [];
    let scanCutoff = "";

    const result = await runTenureExpiryWorker({
      now,
      scan: async (cutoffIso) => {
        scanCutoff = cutoffIso;
        // Emulate the SQL predicate (tenure_end <= cutoff) the real scan uses.
        return scanned.filter((r) => r.tenureEnd <= cutoffIso);
      },
      expireMembership: async (r) => {
        expired.push(r.id);
      },
      notifyExpiring: async (r) => {
        notified.push(r.id);
      },
    });

    // Scan cutoff is exactly today + 30 days.
    expect(scanCutoff).toBe(addDaysIso(toIsoDate(now), DEFAULT_ADVANCE_NOTICE_DAYS));
    expect(expired).toEqual(["due"]);
    expect(notified).toEqual(["soon"]);
    expect(result).toEqual({ scanned: 2, expired: 1, expiring: 1, failed: 0 });
  });

  it("isolates a per-membership failure and keeps processing the rest", async () => {
    const now = new Date(`${TODAY}T03:00:00Z`);
    const scanned = [
      row({ id: "bad", tenureEnd: TODAY }),
      row({ id: "good", tenureEnd: TODAY }),
    ];

    const expired: string[] = [];
    const result = await runTenureExpiryWorker({
      now,
      scan: async () => scanned,
      expireMembership: async (r) => {
        if (r.id === "bad") throw new Error("version conflict");
        expired.push(r.id);
      },
      notifyExpiring: async () => {
        /* none in this scenario */
      },
      logger: { error: () => {}, info: () => {}, warn: () => {} } as never,
    });

    expect(expired).toEqual(["good"]);
    expect(result).toEqual({ scanned: 2, expired: 1, expiring: 0, failed: 1 });
  });
});
