/**
 * MT-006 — push domain logic + PII/secret handling.
 *
 * A device token is a bearer credential: whoever holds it can push to that
 * device. The masking and opt-in assertions here are the guardrails that stop it
 * leaking into a response or a log line.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeDeviceToken,
  maskDeviceToken,
  isValidWebPushEndpoint,
  pushAllowedByPrefs,
  selectDeliverableSubscriptions,
  unreadCount,
  PLATFORMS,
  type StoredSubscription,
} from "../src/modules/push/domain.js";
import type { PrefView } from "../src/modules/templates/domain.js";

function pref(over: Partial<PrefView> = {}): PrefView {
  return {
    id: "p1",
    tenantId: "aaaaaaaa-1111-4000-8000-000000000001",
    userId: "bbbbbbbb-2222-4000-8000-000000000002",
    eventType: "finance.payment.made",
    inApp: true,
    email: true,
    push: true,
    version: 1,
    ...over,
  };
}

function sub(over: Partial<StoredSubscription> = {}): StoredSubscription {
  return { id: "s1", platform: "web", enabled: true, tokenHash: "hash-1", ...over };
}

describe("normalizeDeviceToken", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeDeviceToken("  abc123  ")).toBe("abc123");
  });

  it("preserves case — device tokens are case-sensitive", () => {
    expect(normalizeDeviceToken("AbC123")).toBe("AbC123");
  });

  it("preserves internal characters", () => {
    expect(normalizeDeviceToken("a:b-c_d")).toBe("a:b-c_d");
  });
});

describe("maskDeviceToken", () => {
  it("reveals only the last 4 characters", () => {
    expect(maskDeviceToken("abcdefghijklmnop")).toBe("****mnop");
  });

  it("does not leak the token length", () => {
    expect(maskDeviceToken("a".repeat(200))).toBe("****aaaa");
  });

  it("fully masks a 4-character token", () => {
    expect(maskDeviceToken("abcd")).toBe("****");
  });

  it("fully masks a shorter token", () => {
    expect(maskDeviceToken("ab")).toBe("****");
  });

  it("fully masks an empty token", () => {
    expect(maskDeviceToken("")).toBe("****");
  });

  it("trims before masking so trailing whitespace is not the preview", () => {
    expect(maskDeviceToken("abcdefgh   ")).toBe("****efgh");
  });

  it("never contains the cleartext token", () => {
    const token = "super-secret-device-token-value";
    expect(maskDeviceToken(token)).not.toContain("super-secret");
  });
});

describe("isValidWebPushEndpoint", () => {
  it("accepts https", () => {
    expect(isValidWebPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
  });

  it("rejects http — a plaintext endpoint leaks the push capability", () => {
    expect(isValidWebPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
  });

  it("rejects a non-URL string", () => {
    expect(isValidWebPushEndpoint("not a url")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidWebPushEndpoint("")).toBe(false);
  });

  it("rejects a non-http scheme", () => {
    expect(isValidWebPushEndpoint("ftp://example.com/x")).toBe(false);
  });

  it("rejects javascript:", () => {
    expect(isValidWebPushEndpoint("javascript:alert(1)")).toBe(false);
  });
});

describe("pushAllowedByPrefs — push is opt-in, never assumed", () => {
  it("allows when the matching pref row has push=true", () => {
    expect(pushAllowedByPrefs([pref({ push: true })], "finance.payment.made")).toBe(true);
  });

  it("refuses when the matching pref row has push=false", () => {
    expect(pushAllowedByPrefs([pref({ push: false })], "finance.payment.made")).toBe(false);
  });

  it("refuses when there is no pref row for the event type", () => {
    expect(pushAllowedByPrefs([pref({ eventType: "other.event" })], "finance.payment.made")).toBe(false);
  });

  it("refuses when there are no prefs at all — an interruptive channel needs opt-in", () => {
    expect(pushAllowedByPrefs([], "finance.payment.made")).toBe(false);
  });

  it("falls back to the first pref when no event type is supplied", () => {
    expect(pushAllowedByPrefs([pref({ push: true })])).toBe(true);
    expect(pushAllowedByPrefs([pref({ push: false })])).toBe(false);
  });

  it("refuses on an empty pref list with no event type", () => {
    expect(pushAllowedByPrefs([])).toBe(false);
  });
});

describe("selectDeliverableSubscriptions", () => {
  it("keeps a single enabled subscription", () => {
    expect(selectDeliverableSubscriptions([sub()]).map((s) => s.id)).toEqual(["s1"]);
  });

  it("drops disabled subscriptions", () => {
    expect(selectDeliverableSubscriptions([sub({ enabled: false })])).toEqual([]);
  });

  it("de-duplicates by token hash so a twice-registered device is pushed once", () => {
    const out = selectDeliverableSubscriptions([
      sub({ id: "first", tokenHash: "same" }),
      sub({ id: "second", tokenHash: "same" }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["first"]);
  });

  it("keeps distinct tokens", () => {
    const out = selectDeliverableSubscriptions([
      sub({ id: "a", tokenHash: "h1" }),
      sub({ id: "b", tokenHash: "h2" }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("a disabled duplicate does not consume the token slot", () => {
    const out = selectDeliverableSubscriptions([
      sub({ id: "disabled", tokenHash: "same", enabled: false }),
      sub({ id: "live", tokenHash: "same" }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["live"]);
  });

  it("returns an empty list for no subscriptions", () => {
    expect(selectDeliverableSubscriptions([])).toEqual([]);
  });
});

describe("unreadCount", () => {
  it("counts only unread messages", () => {
    expect(unreadCount([{ readAt: null }, { readAt: new Date() }, { readAt: null }])).toBe(2);
  });

  it("is 0 for an empty inbox", () => {
    expect(unreadCount([])).toBe(0);
  });

  it("is 0 when everything is read", () => {
    expect(unreadCount([{ readAt: new Date() }])).toBe(0);
  });
});

describe("PLATFORMS", () => {
  it("declares exactly web, android and ios", () => {
    expect([...PLATFORMS]).toEqual(["web", "android", "ios"]);
  });
});
