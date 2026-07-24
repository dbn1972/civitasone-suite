/**
 * Domain logic unit tests for notification multi-channel modules.
 * Tests pure functions: scheduling, digest, webhook, DND, i18n, segments, approval, priority.
 * No DB or queue — these are pure logic tests.
 */
import { describe, it, expect } from "vitest";

// ─── SCHEDULING DOMAIN ─────────────────────────────────────────────────────────

import { validateScheduledAt, isScheduleDue } from "../src/modules/scheduling/domain.js";

describe("scheduling/domain", () => {
  it("validateScheduledAt rejects past timestamps", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(validateScheduledAt(past)).toBe(false);
  });

  it("validateScheduledAt accepts future timestamps", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(validateScheduledAt(future)).toBe(true);
  });

  it("validateScheduledAt rejects invalid date strings", () => {
    expect(validateScheduledAt("not-a-date")).toBe(false);
  });

  it("isScheduleDue returns true for past timestamp", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isScheduleDue(past)).toBe(true);
  });

  it("isScheduleDue returns false for future timestamp", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isScheduleDue(future)).toBe(false);
  });
});

// ─── DIGEST DOMAIN ──────────────────────────────────────────────────────────────

import { shouldAccumulate, isWindowExpired, shouldFlushBySize } from "../src/modules/digest/domain.js";

describe("digest/domain", () => {
  const rule = { eventType: "e", channel: "email", accumulationWindowMinutes: 30, maxBatchSize: 50, digestTemplateId: "t", enabled: true };

  it("shouldAccumulate returns true when rule exists and priority is not critical", () => {
    expect(shouldAccumulate(rule, "normal")).toBe(true);
    expect(shouldAccumulate(rule, "high")).toBe(true);
    expect(shouldAccumulate(rule, "low")).toBe(true);
  });

  it("shouldAccumulate returns false for critical priority", () => {
    expect(shouldAccumulate(rule, "critical")).toBe(false);
  });

  it("shouldAccumulate returns false when no rule", () => {
    expect(shouldAccumulate(null, "normal")).toBe(false);
  });

  it("isWindowExpired returns true when window has expired", () => {
    const opened = new Date(Date.now() - 60 * 60_000); // 1 hour ago
    expect(isWindowExpired(opened, 30)).toBe(true);
  });

  it("isWindowExpired returns false when window is still open", () => {
    const opened = new Date(Date.now() - 10 * 60_000); // 10 min ago
    expect(isWindowExpired(opened, 30)).toBe(false);
  });

  it("shouldFlushBySize returns true when count >= max", () => {
    expect(shouldFlushBySize(50, 50)).toBe(true);
    expect(shouldFlushBySize(51, 50)).toBe(true);
  });

  it("shouldFlushBySize returns false when count < max", () => {
    expect(shouldFlushBySize(49, 50)).toBe(false);
  });
});

// ─── WEBHOOK DOMAIN ─────────────────────────────────────────────────────────────

import { signPayload, validateEndpointUrl } from "../src/modules/webhook/domain.js";

describe("webhook/domain", () => {
  it("signPayload produces consistent HMAC-SHA256 hex", () => {
    const sig1 = signPayload("hello", "secret");
    const sig2 = signPayload("hello", "secret");
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64); // 256-bit hex
  });

  it("signPayload changes with different body", () => {
    const sig1 = signPayload("a", "secret");
    const sig2 = signPayload("b", "secret");
    expect(sig1).not.toBe(sig2);
  });

  it("signPayload changes with different secret", () => {
    const sig1 = signPayload("body", "s1");
    const sig2 = signPayload("body", "s2");
    expect(sig1).not.toBe(sig2);
  });

  it("validateEndpointUrl accepts HTTPS", () => {
    expect(validateEndpointUrl("https://hooks.example.com/notify")).toBe(true);
  });

  it("validateEndpointUrl rejects HTTP", () => {
    expect(validateEndpointUrl("http://insecure.com/hook")).toBe(false);
  });

  it("validateEndpointUrl rejects invalid URLs", () => {
    expect(validateEndpointUrl("not-a-url")).toBe(false);
    expect(validateEndpointUrl("")).toBe(false);
  });
});

// ─── DND DOMAIN ─────────────────────────────────────────────────────────────────

import { evaluateWindow, isDndActive } from "../src/modules/dnd/domain.js";
import type { DndWindow } from "../src/modules/dnd/domain.js";

describe("dnd/domain", () => {
  const baseWindow: DndWindow = {
    startTime: "22:00", endTime: "06:00", timezone: "UTC",
    days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], enabled: true,
  };

  it("evaluateWindow returns false for disabled window", () => {
    expect(evaluateWindow({ ...baseWindow, enabled: false })).toBe(false);
  });

  it("isDndActive returns deliver when no windows", () => {
    expect(isDndActive([])).toEqual({ action: "deliver" });
  });

  it("isDndActive returns deliver when window is disabled", () => {
    expect(isDndActive([{ ...baseWindow, enabled: false }])).toEqual({ action: "deliver" });
  });
});

// ─── I18N DOMAIN ────────────────────────────────────────────────────────────────

import { validateBcp47, resolveLocale, findStaleVariants } from "../src/modules/i18n/domain.js";

describe("i18n/domain", () => {
  it("validateBcp47 accepts valid locales", () => {
    expect(validateBcp47("en")).toBe(true);
    expect(validateBcp47("en-US")).toBe(true);
    expect(validateBcp47("hi-IN")).toBe(true);
    expect(validateBcp47("zh-Hans-CN")).toBe(true);
  });

  it("validateBcp47 rejects invalid locales", () => {
    expect(validateBcp47("")).toBe(false);
    expect(validateBcp47("e")).toBe(false);
    expect(validateBcp47("invalid--locale")).toBe(false);
    expect(validateBcp47("toolonglocalestring-that-exceeds-limits-definitely")).toBe(false);
  });

  it("resolveLocale returns exact match for recipient locale", () => {
    const variants = [
      { locale: "hi-IN", subject: "s", body: "b", status: "current" },
      { locale: "en", subject: "s", body: "b", status: "current" },
    ];
    const result = resolveLocale(variants, "hi-IN", "en");
    expect(result?.locale).toBe("hi-IN");
  });

  it("resolveLocale falls back to tenant default", () => {
    const variants = [
      { locale: "en", subject: "s", body: "b", status: "current" },
    ];
    const result = resolveLocale(variants, "hi-IN", "en");
    expect(result?.locale).toBe("en");
  });

  it("resolveLocale returns null when no match", () => {
    const variants = [
      { locale: "fr", subject: "s", body: "b", status: "current" },
    ];
    const result = resolveLocale(variants, "hi-IN", "en");
    expect(result).toBeNull();
  });

  it("resolveLocale skips stale variants (needs_review)", () => {
    const variants = [
      { locale: "hi-IN", subject: "s", body: "b", status: "needs_review" },
    ];
    const result = resolveLocale(variants, "hi-IN", null);
    expect(result).toBeNull();
  });

  it("findStaleVariants returns all current locales", () => {
    const variants = [
      { locale: "hi-IN", subject: "s", body: "b", status: "current" },
      { locale: "en", subject: "s", body: "b", status: "current" },
      { locale: "fr", subject: "s", body: "b", status: "needs_review" },
    ];
    expect(findStaleVariants(variants)).toEqual(["hi-IN", "en"]);
  });
});

// ─── SEGMENTS DOMAIN ────────────────────────────────────────────────────────────

import { validateCriteria, buildSegmentQuery, isSegmentNonEmpty } from "../src/modules/segments/domain.js";

describe("segments/domain", () => {
  it("validateCriteria returns null for valid criteria", () => {
    expect(validateCriteria({ roles: ["admin"] })).toBeNull();
    expect(validateCriteria({ departmentIds: ["abc"] })).toBeNull();
    expect(validateCriteria({ locationIds: ["loc1"], roles: ["x"] })).toBeNull();
    expect(validateCriteria({ attributes: { grade: "A" } })).toBeNull();
  });

  it("validateCriteria returns error for empty criteria", () => {
    expect(validateCriteria({})).not.toBeNull();
    expect(validateCriteria(null)).not.toBeNull();
    expect(validateCriteria(undefined)).not.toBeNull();
  });

  it("validateCriteria returns error for roles with empty strings", () => {
    expect(validateCriteria({ roles: [""] })).not.toBeNull();
  });

  it("buildSegmentQuery builds filters for roles", () => {
    const filters = buildSegmentQuery({ roles: ["admin", "hr_officer"] });
    expect(filters).toHaveLength(1);
    expect(filters[0]!.field).toBe("role");
    expect(filters[0]!.operator).toBe("in");
  });

  it("buildSegmentQuery builds filters for multiple criteria (AND)", () => {
    const filters = buildSegmentQuery({ roles: ["admin"], departmentIds: ["d1"], locationIds: ["l1"] });
    expect(filters).toHaveLength(3);
  });

  it("buildSegmentQuery handles attributes", () => {
    const filters = buildSegmentQuery({ attributes: { grade: "A", level: ["1", "2"] } });
    expect(filters).toHaveLength(2);
    expect(filters[0]!.field).toBe("attr.grade");
    expect(filters[0]!.operator).toBe("eq");
    expect(filters[1]!.field).toBe("attr.level");
    expect(filters[1]!.operator).toBe("in");
  });

  it("isSegmentNonEmpty returns true for count > 0", () => {
    expect(isSegmentNonEmpty(5)).toBe(true);
  });

  it("isSegmentNonEmpty returns false for count = 0", () => {
    expect(isSegmentNonEmpty(0)).toBe(false);
  });
});

// ─── APPROVAL DOMAIN ────────────────────────────────────────────────────────────

import { transitionState, validateMakerChecker, canDeliver } from "../src/modules/approval/domain.js";

describe("approval/domain", () => {
  it("transitionState: draft → in_review (submit)", () => {
    const r = transitionState("draft", "submit");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newStatus).toBe("in_review");
  });

  it("transitionState: in_review → approved (approve)", () => {
    const r = transitionState("in_review", "approve");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newStatus).toBe("approved");
  });

  it("transitionState: in_review → draft (reject)", () => {
    const r = transitionState("in_review", "reject");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newStatus).toBe("draft");
  });

  it("transitionState: approved → published (publish)", () => {
    const r = transitionState("approved", "publish");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newStatus).toBe("published");
  });

  it("transitionState rejects invalid transition: draft → approved", () => {
    const r = transitionState("draft", "approve");
    expect(r.ok).toBe(false);
  });

  it("transitionState rejects invalid transition: draft → published", () => {
    const r = transitionState("draft", "publish");
    expect(r.ok).toBe(false);
  });

  it("transitionState rejects transition from published", () => {
    const r = transitionState("published", "submit");
    expect(r.ok).toBe(false);
  });

  it("validateMakerChecker: different actors → true", () => {
    expect(validateMakerChecker("user-a", "user-b")).toBe(true);
  });

  it("validateMakerChecker: same actor → false", () => {
    expect(validateMakerChecker("user-a", "user-a")).toBe(false);
  });

  it("canDeliver: published → true", () => {
    expect(canDeliver("published")).toBe(true);
  });

  it("canDeliver: draft → false", () => {
    expect(canDeliver("draft")).toBe(false);
  });

  it("canDeliver: in_review → false", () => {
    expect(canDeliver("in_review")).toBe(false);
  });

  it("canDeliver: approved → false", () => {
    expect(canDeliver("approved")).toBe(false);
  });
});

// ─── PRIORITY DOMAIN ────────────────────────────────────────────────────────────

import { classify, getRetryPolicy, shouldBypassDnd, shouldBypassDigest } from "../src/modules/priority/domain.js";

describe("priority/domain", () => {
  it("classify returns a valid priority level", () => {
    const result = classify("high");
    expect(["low", "normal", "high", "critical"]).toContain(result);
  });

  it("classify defaults to normal for unknown input", () => {
    const result = classify("unknown" as string);
    expect(result).toBe("normal");
  });

  it("getRetryPolicy returns retry config", () => {
    const policy = getRetryPolicy("critical");
    expect(policy).toHaveProperty("maxAttempts");
    expect(policy).toHaveProperty("backoffMs");
  });

  it("shouldBypassDnd: critical → true", () => {
    expect(shouldBypassDnd("critical")).toBe(true);
  });

  it("shouldBypassDnd: normal → false", () => {
    expect(shouldBypassDnd("normal")).toBe(false);
  });

  it("shouldBypassDigest: critical → true", () => {
    expect(shouldBypassDigest("critical")).toBe(true);
  });

  it("shouldBypassDigest: normal → false", () => {
    expect(shouldBypassDigest("normal")).toBe(false);
  });
});

// ─── ANALYTICS DOMAIN ───────────────────────────────────────────────────────────

import { instrumentHtml, buildMetricsAggregate } from "../src/modules/analytics/domain.js";

describe("analytics/domain", () => {
  it("instrumentHtml adds tracking pixel before </body>", () => {
    const html = "<html><body><p>Hello</p></body></html>";
    const result = instrumentHtml(html, "del-1", "https://track.example.com", false);
    expect(result).toContain("pixel/del-1.png");
    expect(result).toContain('width="1"');
  });

  it("instrumentHtml wraps links through click tracker", () => {
    const html = '<html><body><a href="https://target.com">Click</a></body></html>';
    const result = instrumentHtml(html, "del-2", "https://track.example.com", false);
    expect(result).toContain("/t/click/del-2");
    expect(result).toContain(encodeURIComponent("https://target.com"));
  });

  it("instrumentHtml respects opt-out (returns original)", () => {
    const html = "<html><body><p>Hi</p></body></html>";
    const result = instrumentHtml(html, "del-3", "https://t.com", true);
    expect(result).toBe(html);
  });

  it("buildMetricsAggregate computes rates correctly", () => {
    const events = [
      { type: "sent" as const, deliveryId: "a", timestamp: new Date() },
      { type: "sent" as const, deliveryId: "b", timestamp: new Date() },
      { type: "open" as const, deliveryId: "a", timestamp: new Date() },
      { type: "click" as const, deliveryId: "a", timestamp: new Date() },
    ];
    const agg = buildMetricsAggregate(events);
    expect(agg.sentCount).toBe(2);
    expect(agg.openCount).toBe(1);
    expect(agg.clickCount).toBe(1);
    expect(agg.openRate).toBe(0.5);
    expect(agg.clickRate).toBe(0.5);
  });

  it("buildMetricsAggregate handles empty events", () => {
    const agg = buildMetricsAggregate([]);
    expect(agg.sentCount).toBe(0);
    expect(agg.openRate).toBe(0);
  });
});

// ─── RENDER / MJML ──────────────────────────────────────────────────────────────

import { renderBody, resolvePartials } from "../src/adapters/render.js";

describe("render adapter", () => {
  it("renderBody replaces {{key}} placeholders", () => {
    expect(renderBody("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  it("renderBody preserves unmatched placeholders", () => {
    expect(renderBody("Hi {{missing}}", {})).toBe("Hi {{missing}}");
  });

  it("renderBody returns body unchanged when no variables", () => {
    expect(renderBody("No vars")).toBe("No vars");
  });

  it("resolvePartials inlines partials", () => {
    const source = "Header: {{> header}} Body content {{> footer}}";
    const partials = [
      { name: "header", body: "<h1>Title</h1>" },
      { name: "footer", body: "<footer>End</footer>" },
    ];
    const result = resolvePartials(source, partials);
    expect(result).toContain("<h1>Title</h1>");
    expect(result).toContain("<footer>End</footer>");
  });

  it("resolvePartials adds comment for missing partials", () => {
    const result = resolvePartials("{{> missing}}", []);
    expect(result).toContain("not found");
  });

  it("resolvePartials handles nested partials up to max depth", () => {
    const partials = [
      { name: "a", body: "{{> b}} A" },
      { name: "b", body: "B" },
    ];
    const result = resolvePartials("{{> a}}", partials);
    expect(result).toContain("B A");
  });
});
