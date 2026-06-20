import { describe, it, expect } from "vitest";
import { planTemplateVersion, isSuperseded } from "../src/modules/templates/versioning.js";
import type { TemplateView } from "../src/modules/templates/domain.js";
import { computeNextRetryAt, retryDelaySeconds, shouldRetry, RETRY_DELAY_SECONDS } from "../src/modules/deliveries/retry.js";

describe("template versioning", () => {
  const base: TemplateView = {
    id: "aaaaaaaa-1111-4000-8000-000000000001",
    tenantId: "t1",
    channel: "email",
    name: "Welcome",
    subject: "Hi",
    body: "Hello",
    status: "active",
    version: 1,
    supersededBy: null,
  };

  it("update template creates new version and supersedes old", () => {
    const newId = "bbbbbbbb-2222-4000-8000-000000000002";
    const plan = planTemplateVersion(base, newId);
    expect(plan).toEqual({ newId, oldId: base.id, version: 2 });
    expect(isSuperseded({ ...base, supersededBy: newId })).toBe(true);
    expect(isSuperseded(base)).toBe(false);
  });
});

describe("delivery retry backoff", () => {
  it("failure on retry_count=0 schedules next_retry_at = now + 15m", () => {
    const now = new Date("2026-06-20T10:00:00.000Z");
    const next = computeNextRetryAt(0, now);
    expect(retryDelaySeconds(0)).toBe(RETRY_DELAY_SECONDS[0]);
    expect(next.getTime() - now.getTime()).toBe(15 * 60 * 1000);
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(3)).toBe(false);
  });

  it("uses exponential backoff delays 15m, 60m, 240m", () => {
    expect(RETRY_DELAY_SECONDS).toEqual([900, 3600, 14400]);
    const t0 = new Date("2026-06-20T10:00:00.000Z");
    expect(computeNextRetryAt(1, t0).getTime()).toBe(t0.getTime() + 3600 * 1000);
    expect(computeNextRetryAt(2, t0).getTime()).toBe(t0.getTime() + 14400 * 1000);
  });
});
