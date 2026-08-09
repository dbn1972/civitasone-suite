/**
 * FN-30 — Service API / Webhook Exposure.
 * BRD acceptance: "staging webhook receives `issued` event payload."
 */
import { describe, it, expect } from "vitest";
import {
  WEBHOOK_EVENTS,
  assertWebhookSubscriptions,
  buildWebhookEvent,
  eventForStatus,
  isWebhookEvent,
  ServiceWebhookError,
  subscribersFor,
  type ServiceWebhookSubscription,
} from "./service-webhooks.js";
import { APPLICATION_STATUSES } from "../application/domain.js";

// Not a credential. The publish gate only requires >= 16 characters, so this
// is a length fixture built at runtime — a literal here trips secret scanning.
const SECRET = "x".repeat(24);

function sub(over: Partial<ServiceWebhookSubscription> = {}): ServiceWebhookSubscription {
  return {
    id: "sub-police",
    url: "https://police.odisha.gov.in/hooks/civitasone",
    events: ["application.issued"],
    secret: SECRET,
    active: true,
    description: "State police verification callback",
    ...over,
  };
}

describe("FN-30 event catalogue", () => {
  it("derives exactly one event per real application status", () => {
    // Guards the drift this design exists to prevent: a status added without a
    // matching event, or an event for a status that can never occur.
    expect(WEBHOOK_EVENTS).toHaveLength(APPLICATION_STATUSES.length);
    for (const s of APPLICATION_STATUSES) {
      expect(WEBHOOK_EVENTS).toContain(`application.${s}`);
    }
  });

  it("maps a status to its event", () => {
    expect(eventForStatus("issued")).toBe("application.issued");
  });

  it("rejects anything outside the catalogue", () => {
    expect(isWebhookEvent("application.issued")).toBe(true);
    expect(isWebhookEvent("application.deleted")).toBe(false);
    expect(isWebhookEvent("issued")).toBe(false);
  });
});

describe("FN-30 buildWebhookEvent — BRD acceptance payload", () => {
  const base = {
    status: "issued" as const,
    occurredAt: "2026-08-08T09:30:00.000Z",
    serviceKey: "pack:event-permission",
    applicationNumber: "EP/W12/2026/00042",
    tenantId: "tenant-bbsr",
    officeId: "office-central",
    outputNumber: "EP/W12/2026/00042",
  };

  it("emits an issued event payload the receiver can act on", () => {
    const p = buildWebhookEvent(base);
    expect(p.event).toBe("application.issued");
    expect(p.status).toBe("issued");
    expect(p.applicationNumber).toBe("EP/W12/2026/00042");
    expect(p.serviceKey).toBe("pack:event-permission");
    expect(p.tenantId).toBe("tenant-bbsr");
    expect(p.officeId).toBe("office-central");
    expect(p.outputNumber).toBe("EP/W12/2026/00042");
    expect(p.occurredAt).toBe("2026-08-08T09:30:00.000Z");
  });

  it("carries case metadata only — never applicant data", () => {
    // The allow-list is the guarantee. If this key set ever grows, the new key
    // must be reviewed against "would a citizen expect this sent to a third
    // party?" before the assertion is relaxed.
    expect(Object.keys(buildWebhookEvent(base)).sort()).toEqual(
      [
        "applicationNumber", "event", "occurredAt", "officeId",
        "outputNumber", "serviceKey", "status", "tenantId",
      ].sort(),
    );
  });

  it("ignores extra input keys rather than passing them through", () => {
    const p = buildWebhookEvent({ ...base, formData: { aadhaarNumber: "1234" } } as never);
    expect(JSON.stringify(p)).not.toContain("1234");
    expect(p).not.toHaveProperty("formData");
  });

  it("omits the output number on non-terminal states", () => {
    // Sending last state's output number on `under_review` would misinform.
    const p = buildWebhookEvent({ ...base, status: "under_review" });
    expect(p.event).toBe("application.under_review");
    expect(p).not.toHaveProperty("outputNumber");
  });

  it("omits optional keys rather than emitting nulls", () => {
    const p = buildWebhookEvent({ ...base, officeId: null, outputNumber: null });
    expect(p).not.toHaveProperty("officeId");
    expect(p).not.toHaveProperty("outputNumber");
  });
});

describe("FN-30 subscribersFor", () => {
  it("delivers only to endpoints that asked for the event", () => {
    const subs = [
      sub({ id: "a", events: ["application.issued"] }),
      sub({ id: "b", events: ["application.rejected"] }),
      sub({ id: "c", events: ["application.issued", "application.approved"] }),
    ];
    expect(subscribersFor(subs, "application.issued").map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("skips inactive subscriptions", () => {
    expect(subscribersFor([sub({ active: false })], "application.issued")).toEqual([]);
  });

  it("handles an absent subscription list", () => {
    expect(subscribersFor(null, "application.issued")).toEqual([]);
    expect(subscribersFor(undefined, "application.issued")).toEqual([]);
  });
});

describe("FN-30 assertWebhookSubscriptions — publish gate", () => {
  it("accepts an absent or empty list", () => {
    expect(() => assertWebhookSubscriptions(null)).not.toThrow();
    expect(() => assertWebhookSubscriptions([])).not.toThrow();
  });

  it("accepts a well-formed subscription", () => {
    expect(() => assertWebhookSubscriptions([sub()])).not.toThrow();
  });

  it("rejects a non-list or a non-object entry", () => {
    expect(() => assertWebhookSubscriptions({})).toThrow(ServiceWebhookError);
    expect(() => assertWebhookSubscriptions(["https://x.gov.in"])).toThrow(/NOT_AN_OBJECT/);
  });

  it("rejects a missing or duplicated id", () => {
    expect(() => assertWebhookSubscriptions([sub({ id: " " })])).toThrow(/MISSING_ID/);
    expect(() => assertWebhookSubscriptions([sub(), sub()])).toThrow(/DUPLICATE_ID/);
  });

  it("rejects a malformed or non-HTTPS URL", () => {
    expect(() => assertWebhookSubscriptions([sub({ url: "not a url" })])).toThrow(/BAD_URL/);
    expect(() => assertWebhookSubscriptions([sub({ url: "http://police.gov.in/hook" })])).toThrow(/NOT_HTTPS/);
  });

  it("rejects endpoints pointing back into the platform's own network (SSRF)", () => {
    const hostile = [
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.0.3.9/hook",
      "https://192.168.1.5/hook",
      "https://172.20.0.4/hook",
      "https://169.254.169.254/latest/meta-data/",
      "https://metadata.google.internal/computeMetadata/v1/",
      "https://redis.internal:6379/hook",
      "https://postgres.local/hook",
      "https://[::1]/hook",
      "https://[fd00::1]/hook",
      "https://[fe80::1]/hook",
    ];
    for (const url of hostile) {
      expect(() => assertWebhookSubscriptions([sub({ url })]), url).toThrow(/FORBIDDEN_HOST/);
    }
  });

  it("still allows ordinary public government endpoints", () => {
    for (const url of [
      "https://police.odisha.gov.in/hooks/x",
      "https://api.digitallocker.gov.in/callback",
      "https://172.15.0.1/hook", // just outside the 172.16–31 private range
      "https://11.0.0.1/hook",   // just outside 10/8
    ]) {
      expect(() => assertWebhookSubscriptions([sub({ url })]), url).not.toThrow();
    }
  });

  it("rejects a subscription that would receive nothing", () => {
    expect(() => assertWebhookSubscriptions([sub({ events: [] })])).toThrow(/NO_EVENTS/);
  });

  it("rejects an unknown or repeated event", () => {
    expect(() => assertWebhookSubscriptions([sub({ events: ["application.deleted"] as never })])).toThrow(
      /UNKNOWN_EVENT/,
    );
    expect(() =>
      assertWebhookSubscriptions([sub({ events: ["application.issued", "application.issued"] })]),
    ).toThrow(/DUPLICATE_EVENT/);
  });

  it("rejects a secret too weak to authenticate the callback", () => {
    expect(() => assertWebhookSubscriptions([sub({ secret: "short" })])).toThrow(/WEAK_SECRET/);
    expect(() => assertWebhookSubscriptions([sub({ secret: undefined as never })])).toThrow(/WEAK_SECRET/);
  });

  it("rejects a missing active flag", () => {
    expect(() => assertWebhookSubscriptions([sub({ active: undefined as never })])).toThrow(/MISSING_ACTIVE/);
  });
});
