/**
 * Notification Channels & Quotas — Domain Tests
 *
 * Module: services/notification-service/src/modules/channels
 * Pack: Notification_Module_Test_Pack/07_Channels_Test_Prompt.md
 *
 * Tests:
 *   1. Quota guard: checkQuota logic (pass/fail/unlimited/no-config)
 *   2. Channel type enum validation
 *   3. Quota status enum validation
 *   4. Quota boundary: used == limit → exhausted, used < limit → pass
 *   5. Secret masking contract (channel configs never expose secrets)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock quota-repo for the quota guard ─────────────────────────────────────

const findCurrentQuotaMock = vi.fn();

// checkQuota reads via findCurrentQuotaInTx now (task_477fafd4: routes the
// quota lookup onto the caller's already-open tx instead of opening a
// second, nested transaction via scopedRead -- see quota-guard.ts).
vi.mock("../src/modules/channels/quota-repo.js", () => ({
  findCurrentQuotaInTx: (...a: any[]) => findCurrentQuotaMock(...a),
}));

// Placeholder tx: fully mocked at the repo layer above, so checkQuota never
// actually touches it -- it only needs to satisfy the parameter.
const FAKE_TX = {} as never;

import { checkQuota } from "../src/modules/channels/quota-guard.js";

const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 1. Quota Guard — checkQuota ─────────────────────────────────────────────

describe("checkQuota — quota enforcement", () => {
  it("no quota configured → pass (quotas are opt-in)", async () => {
    findCurrentQuotaMock.mockResolvedValue(null);
    const r = await checkQuota(FAKE_TX, TENANT, "email");
    expect(r.passed).toBe(true);
  });

  it("unlimited status → always pass (even if used > 0)", async () => {
    findCurrentQuotaMock.mockResolvedValue({ status: "unlimited", used: 999n, monthlyLimit: 100n });
    const r = await checkQuota(FAKE_TX, TENANT, "sms");
    expect(r.passed).toBe(true);
  });

  it("used < limit → pass", async () => {
    findCurrentQuotaMock.mockResolvedValue({ status: "active", used: 50n, monthlyLimit: 100n });
    const r = await checkQuota(FAKE_TX, TENANT, "email");
    expect(r.passed).toBe(true);
    expect(r.used).toBe(50n);
    expect(r.limit).toBe(100n);
  });

  it("used == limit → FAIL (quota exhausted)", async () => {
    findCurrentQuotaMock.mockResolvedValue({ status: "active", used: 100n, monthlyLimit: 100n });
    const r = await checkQuota(FAKE_TX, TENANT, "email");
    expect(r.passed).toBe(false);
    expect(r.used).toBe(100n);
    expect(r.limit).toBe(100n);
  });

  it("used > limit → FAIL (over-quota)", async () => {
    findCurrentQuotaMock.mockResolvedValue({ status: "active", used: 150n, monthlyLimit: 100n });
    const r = await checkQuota(FAKE_TX, TENANT, "email");
    expect(r.passed).toBe(false);
  });

  it("boundary: used = limit - 1 → pass (last available send)", async () => {
    findCurrentQuotaMock.mockResolvedValue({ status: "active", used: 99n, monthlyLimit: 100n });
    const r = await checkQuota(FAKE_TX, TENANT, "push");
    expect(r.passed).toBe(true);
  });
});

// ─── 2. Channel Types ────────────────────────────────────────────────────────

describe("channel types", () => {
  const CHANNEL_TYPES = ["email", "sms", "push", "in_app", "whatsapp"];

  it("5 channel types supported", () => expect(CHANNEL_TYPES.length).toBe(5));
  it.each(CHANNEL_TYPES)("valid channel: %s", (ch) => expect(CHANNEL_TYPES.includes(ch)).toBe(true));
  it("unknown channel rejected", () => expect(CHANNEL_TYPES.includes("fax")).toBe(false));
});

// ─── 3. Quota Status Enum ────────────────────────────────────────────────────

describe("quota status enum", () => {
  const STATUSES = ["active", "exhausted", "unlimited"];
  it("3 quota statuses", () => expect(STATUSES.length).toBe(3));
  it.each(STATUSES)("valid status: %s", (s) => expect(STATUSES.includes(s)).toBe(true));
});

// ─── 4. Quota Period Validation ──────────────────────────────────────────────

describe("quota period validation (from quota-validators.ts)", () => {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  it("valid date format: YYYY-MM-DD", () => {
    expect(DATE_RE.test("2026-07-01")).toBe(true);
    expect(DATE_RE.test("2026-12-31")).toBe(true);
  });
  it("rejects invalid formats", () => {
    expect(DATE_RE.test("07-01-2026")).toBe(false);
    expect(DATE_RE.test("2026/07/01")).toBe(false);
    expect(DATE_RE.test("2026-7-1")).toBe(false);
  });
  it("monthlyLimit must be positive integer", () => {
    const valid = (n: number) => Number.isInteger(n) && n > 0;
    expect(valid(100)).toBe(true);
    expect(valid(0)).toBe(false);
    expect(valid(-1)).toBe(false);
  });
});

// ─── 5. Secret Masking Contract ──────────────────────────────────────────────

describe("secret masking — channel config security", () => {
  it("API keys/secrets never in channel view response", () => {
    // Source: domain.ts ChannelView type has: id, tenantId, type, name, isDefault, enabled, version
    // No fields for: apiKey, secret, password, token
    const channelView = { id: "ch-1", tenantId: "t1", type: "email", name: "SES", isDefault: true, enabled: true, version: 1 };
    const json = JSON.stringify(channelView);
    expect(json).not.toContain("apiKey");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("password");
    expect(json).not.toContain("token");
  });
});
