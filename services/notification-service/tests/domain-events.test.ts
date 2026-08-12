/**
 * Notification Domain Events — Template Registry + Interpolation Tests
 *
 * Module: services/notification-service/src/modules/domain-events
 * Pack: Notification_Module_Test_Pack/13_Domain_Events_Test_Prompt.md
 *
 * Tests:
 *   1. getTemplateForEvent: lookup by eventType, unknown returns undefined
 *   2. interpolate: {{placeholder}} substitution, unresolved left as-is
 *   3. getRegisteredEventTypes: all expected cross-service events registered
 *   4. Template schema: every template has push.title, push.body, email.title, email.body
 *   5. No PII in template literals (only placeholders carry dynamic data)
 */
import { describe, it, expect } from "vitest";
import { getTemplateForEvent, interpolate, getRegisteredEventTypes } from "../src/modules/domain-events/templates.js";

// ─── 1. getTemplateForEvent — lookup ─────────────────────────────────────────

describe("getTemplateForEvent — template registry lookup", () => {
  it("finds registered event: hrms.leave.approved", () => {
    const t = getTemplateForEvent("hrms.leave.approved");
    expect(t).toBeDefined();
    expect(t!.eventType).toBe("hrms.leave.approved");
    expect(t!.push.title).toBe("Leave Approved");
  });

  it("finds registered event: finance.payment.made", () => {
    const t = getTemplateForEvent("finance.payment.made");
    expect(t).toBeDefined();
    expect(t!.push.title).toBe("Payment Processed");
  });

  it("finds registered event: helpdesk.ticket.created", () => {
    const t = getTemplateForEvent("helpdesk.ticket.created");
    expect(t).toBeDefined();
    expect(t!.push.body).toContain("{{ticketNo}}");
  });

  it("finds registered event: citizen.request.created", () => {
    const t = getTemplateForEvent("citizen.request.created");
    expect(t).toBeDefined();
  });

  it("unknown event → undefined (no invented template)", () => {
    expect(getTemplateForEvent("nonexistent.event")).toBeUndefined();
  });

  it("empty string → undefined", () => {
    expect(getTemplateForEvent("")).toBeUndefined();
  });
});

// ─── 2. interpolate — placeholder substitution ───────────────────────────────

describe("interpolate — {{placeholder}} substitution", () => {
  it("replaces single placeholder", () => {
    expect(interpolate("Hello {{name}}", { name: "Ramesh" })).toBe("Hello Ramesh");
  });

  it("replaces multiple placeholders", () => {
    const result = interpolate("{{action}} by {{actor}} on {{date}}", { action: "Approved", actor: "Director", date: "2026-07-15" });
    expect(result).toBe("Approved by Director on 2026-07-15");
  });

  it("unresolved placeholder left as-is (graceful degradation)", () => {
    expect(interpolate("Hello {{name}}, your {{missing}} is ready", { name: "John" })).toBe("Hello John, your {{missing}} is ready");
  });

  it("no placeholders → returns template unchanged", () => {
    expect(interpolate("Static text only", {})).toBe("Static text only");
  });

  it("empty variables → all placeholders left as-is", () => {
    expect(interpolate("{{a}} and {{b}}", {})).toBe("{{a}} and {{b}}");
  });

  it("handles special characters in values safely", () => {
    expect(interpolate("Amount: {{amount}}", { amount: "₹5,00,000" })).toBe("Amount: ₹5,00,000");
  });

  it("does not execute code in placeholder values", () => {
    expect(interpolate("{{val}}", { val: "${process.exit()}" })).toBe("${process.exit()}");
  });
});

// ─── 3. getRegisteredEventTypes — cross-service coverage ─────────────────────

describe("getRegisteredEventTypes — event coverage", () => {
  const events = getRegisteredEventTypes();

  it("has 10+ registered event types", () => {
    expect(events.length).toBeGreaterThanOrEqual(10);
  });

  it("covers HRMS events", () => {
    expect(events).toContain("hrms.leave.approved");
    expect(events).toContain("hrms.leave.applied");
  });

  it("covers Finance events", () => {
    expect(events).toContain("finance.sanction.approved");
    expect(events).toContain("finance.payment.made");
    expect(events).toContain("finance.bill.passed");
  });

  it("covers Procurement events", () => {
    expect(events).toContain("procurement.grn.accepted");
  });

  it("covers Helpdesk events", () => {
    expect(events).toContain("helpdesk.ticket.created");
    expect(events).toContain("helpdesk.ticket.escalated");
  });

  it("covers Citizen events", () => {
    expect(events).toContain("citizen.request.created");
  });

  it("covers ML predictions", () => {
    expect(events).toContain("ml.prediction.anomaly_detected");
  });

  it("covers Contract events", () => {
    expect(events).toContain("contract.expiry.alert");
  });
});

// ─── 4. Template schema — structure validation ───────────────────────────────

describe("template schema — every template has required fields", () => {
  const events = getRegisteredEventTypes();

  it("every registered template has push.title and push.body", () => {
    for (const evt of events) {
      const t = getTemplateForEvent(evt);
      expect(t!.push.title.length).toBeGreaterThan(0);
      expect(t!.push.body.length).toBeGreaterThan(0);
    }
  });

  it("every registered template has email.title and email.body", () => {
    for (const evt of events) {
      const t = getTemplateForEvent(evt);
      expect(t!.email.title.length).toBeGreaterThan(0);
      expect(t!.email.body.length).toBeGreaterThan(0);
    }
  });
});

// ─── 5. No PII in template literals ──────────────────────────────────────────

describe("template security — no PII in literals", () => {
  it("templates contain only {{placeholder}} tokens for dynamic data", () => {
    const events = getRegisteredEventTypes();
    for (const evt of events) {
      const t = getTemplateForEvent(evt)!;
      // No email/phone/aadhaar/PAN literals baked into templates
      const allText = t.push.title + t.push.body + t.email.title + t.email.body;
      expect(allText).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/); // no PAN
      expect(allText).not.toMatch(/\b\d{4}\s?\d{4}\s?\d{4}\b/); // no Aadhaar
      expect(allText).not.toMatch(/\b\d{10}\b/); // no 10-digit phone
    }
  });
});
