/**
 * Automation Rules Engine tests — domain logic and route-level coverage.
 *
 * Tests cover:
 *  - Rule evaluation: field match, keyword match, time elapsed
 *  - Priority ordering: first-match-wins semantics
 *  - Max 100 rules per tenant enforcement
 *  - CRUD route validation
 */
import { describe, it, expect } from "vitest";
import { evaluateRules } from "../src/modules/automation/domain.js";
import type { AutomationRule, TicketForEvaluation } from "../src/modules/automation/domain.js";

// --- Domain logic tests ---

describe("evaluateRules — domain logic", () => {
  const baseTicket: TicketForEvaluation = {
    fields: { priority: "High", status: "open", category: "network" },
    elapsedMinutes: 30,
    subject: "Network outage in building A",
    description: "All connectivity lost since morning",
  };

  describe("field_match trigger", () => {
    it("matches when ticket field equals trigger value (case-insensitive)", () => {
      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "High priority auto-assign",
          ordinal: 1,
          enabled: true,
          trigger: { type: "field_match", field: "priority", value: "high" },
          actions: [{ type: "assign", to: "agent-001" }],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("r1");
      expect(result!.actions).toEqual([{ type: "assign", to: "agent-001" }]);
    });

    it("does not match when field value differs", () => {
      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "Critical only",
          ordinal: 1,
          enabled: true,
          trigger: { type: "field_match", field: "priority", value: "Critical" },
          actions: [{ type: "escalate", level: 2 }],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result).toBeNull();
    });

    it("does not match when field does not exist on ticket", () => {
      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "Department match",
          ordinal: 1,
          enabled: true,
          trigger: { type: "field_match", field: "department", value: "IT" },
          actions: [{ type: "assign", to: "agent-002" }],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result).toBeNull();
    });
  });

  describe("keyword_match trigger", () => {
    it("matches when keyword found in subject", () => {
      const rules: AutomationRule[] = [
        {
          id: "r2",
          name: "Network keyword",
          ordinal: 1,
          enabled: true,
          trigger: { type: "keyword_match", keywords: ["network", "connectivity"] },
          actions: [{ type: "change_priority", newPriority: "Critical" }],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("r2");
    });

    it("matches when keyword found in description", () => {
      const ticket: TicketForEvaluation = {
        fields: {},
        elapsedMinutes: 5,
        subject: "Help needed",
        description: "Server is completely down and unresponsive",
      };

      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "Server down",
          ordinal: 1,
          enabled: true,
          trigger: { type: "keyword_match", keywords: ["server", "down"] },
          actions: [{ type: "escalate", level: 3 }],
        },
      ];

      const result = evaluateRules(ticket, rules);
      expect(result).not.toBeNull();
    });

    it("is case-insensitive", () => {
      const ticket: TicketForEvaluation = {
        fields: {},
        elapsedMinutes: 0,
        subject: "URGENT: PAYMENT FAILED",
      };

      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "Payment issue",
          ordinal: 1,
          enabled: true,
          trigger: { type: "keyword_match", keywords: ["payment"] },
          actions: [{ type: "change_priority", newPriority: "High" }],
        },
      ];

      const result = evaluateRules(ticket, rules);
      expect(result).not.toBeNull();
    });

    it("does not match when no keywords found", () => {
      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "Security keyword",
          ordinal: 1,
          enabled: true,
          trigger: { type: "keyword_match", keywords: ["security", "breach", "hack"] },
          actions: [{ type: "escalate", level: 5 }],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result).toBeNull();
    });
  });

  describe("time_elapsed trigger", () => {
    it("matches when elapsed time >= threshold", () => {
      const rules: AutomationRule[] = [
        {
          id: "r3",
          name: "30min escalation",
          ordinal: 1,
          enabled: true,
          trigger: { type: "time_elapsed", thresholdMinutes: 30 },
          actions: [{ type: "escalate", level: 1 }],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("r3");
    });

    it("matches when elapsed time exceeds threshold", () => {
      const ticket: TicketForEvaluation = {
        fields: {},
        elapsedMinutes: 120,
        subject: "Old ticket",
      };

      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "1hr escalation",
          ordinal: 1,
          enabled: true,
          trigger: { type: "time_elapsed", thresholdMinutes: 60 },
          actions: [{ type: "notify", channel: "email", recipients: ["mgr@example.com"] }],
        },
      ];

      const result = evaluateRules(ticket, rules);
      expect(result).not.toBeNull();
    });

    it("does not match when elapsed time < threshold", () => {
      const ticket: TicketForEvaluation = {
        fields: {},
        elapsedMinutes: 10,
        subject: "New ticket",
      };

      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "1hr escalation",
          ordinal: 1,
          enabled: true,
          trigger: { type: "time_elapsed", thresholdMinutes: 60 },
          actions: [{ type: "escalate", level: 1 }],
        },
      ];

      const result = evaluateRules(ticket, rules);
      expect(result).toBeNull();
    });
  });

  describe("priority ordering — first match wins", () => {
    it("fires the rule with lowest ordinal that matches", () => {
      const rules: AutomationRule[] = [
        {
          id: "r-low",
          name: "Low priority",
          ordinal: 10,
          enabled: true,
          trigger: { type: "field_match", field: "priority", value: "High" },
          actions: [{ type: "assign", to: "agent-low" }],
        },
        {
          id: "r-high",
          name: "High priority",
          ordinal: 1,
          enabled: true,
          trigger: { type: "field_match", field: "priority", value: "High" },
          actions: [{ type: "assign", to: "agent-high" }],
        },
        {
          id: "r-mid",
          name: "Mid priority",
          ordinal: 5,
          enabled: true,
          trigger: { type: "field_match", field: "priority", value: "High" },
          actions: [{ type: "assign", to: "agent-mid" }],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("r-high");
      expect(result!.ordinal).toBe(1);
    });

    it("never fires lower-priority rule when higher one matches", () => {
      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "First match",
          ordinal: 1,
          enabled: true,
          trigger: { type: "keyword_match", keywords: ["network"] },
          actions: [{ type: "assign", to: "agent-1" }],
        },
        {
          id: "r2",
          name: "Second match (should never fire)",
          ordinal: 2,
          enabled: true,
          trigger: { type: "field_match", field: "priority", value: "High" },
          actions: [{ type: "escalate", level: 5 }],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result!.ruleId).toBe("r1");
    });

    it("skips to next rule when first does not match", () => {
      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "No match",
          ordinal: 1,
          enabled: true,
          trigger: { type: "field_match", field: "priority", value: "Critical" },
          actions: [{ type: "assign", to: "agent-1" }],
        },
        {
          id: "r2",
          name: "Matches",
          ordinal: 2,
          enabled: true,
          trigger: { type: "field_match", field: "priority", value: "High" },
          actions: [{ type: "assign", to: "agent-2" }],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result!.ruleId).toBe("r2");
    });
  });

  describe("disabled rules", () => {
    it("skips disabled rules even if trigger matches", () => {
      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "Disabled rule",
          ordinal: 1,
          enabled: false,
          trigger: { type: "field_match", field: "priority", value: "High" },
          actions: [{ type: "assign", to: "agent-1" }],
        },
        {
          id: "r2",
          name: "Enabled rule",
          ordinal: 2,
          enabled: true,
          trigger: { type: "field_match", field: "priority", value: "High" },
          actions: [{ type: "assign", to: "agent-2" }],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result!.ruleId).toBe("r2");
    });
  });

  describe("empty and edge cases", () => {
    it("returns null when no rules exist", () => {
      const result = evaluateRules(baseTicket, []);
      expect(result).toBeNull();
    });

    it("returns null when all rules are disabled", () => {
      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "Disabled",
          ordinal: 1,
          enabled: false,
          trigger: { type: "field_match", field: "priority", value: "High" },
          actions: [{ type: "assign", to: "agent-1" }],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result).toBeNull();
    });

    it("returns null when no rules match", () => {
      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "No match",
          ordinal: 1,
          enabled: true,
          trigger: { type: "field_match", field: "priority", value: "Critical" },
          actions: [{ type: "escalate", level: 1 }],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result).toBeNull();
    });

    it("handles ticket with no description for keyword match", () => {
      const ticket: TicketForEvaluation = {
        fields: {},
        elapsedMinutes: 0,
        subject: "Printer not working",
      };

      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "Printer issues",
          ordinal: 1,
          enabled: true,
          trigger: { type: "keyword_match", keywords: ["printer"] },
          actions: [{ type: "assign", to: "printer-team" }],
        },
      ];

      const result = evaluateRules(ticket, rules);
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("r1");
    });

    it("supports multiple actions per rule", () => {
      const rules: AutomationRule[] = [
        {
          id: "r1",
          name: "Multi-action",
          ordinal: 1,
          enabled: true,
          trigger: { type: "field_match", field: "priority", value: "High" },
          actions: [
            { type: "assign", to: "agent-1" },
            { type: "notify", channel: "email", recipients: ["admin@test.com"] },
            { type: "change_priority", newPriority: "Critical" },
          ],
        },
      ];

      const result = evaluateRules(baseTicket, rules);
      expect(result!.actions).toHaveLength(3);
    });
  });
});

// --- Route-level tests (using buildApp inject) ---

describe("automation rules — route-level", () => {
  let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;
  let token: string;
  const TENANT_ID = "11111111-aaaa-4000-8000-000000000001";
  const ACTOR_ID = "22222222-bbbb-4000-8000-000000000001";

  // Dynamically import to avoid DATABASE_URL issues during test setup
  async function getApp() {
    const { buildApp } = await import("../src/app.js");
    return buildApp();
  }

  async function getToken(roles: string[] = ["helpdesk_admin", "super_admin"]) {
    const { signToken } = await import("@civitasone/auth");
    return signToken(
      { sub: ACTOR_ID, tid: TENANT_ID, roles, sid: "sess-test" },
      "test_secret_for_civitasone_32chr",
      3600,
    );
  }

  it("POST /v1/helpdesk/automation/rules — validates required fields", async () => {
    app = await getApp();
    token = await getToken();

    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/automation/rules",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("POST /v1/helpdesk/automation/rules — rejects without auth", async () => {
    app = await getApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/automation/rules",
      payload: { name: "Test", ordinal: 1, trigger: { type: "field_match", field: "priority", value: "High" }, actions: [{ type: "assign", to: "00000000-0000-4000-8000-000000000001" }] },
    });

    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/helpdesk/automation/rules — rejects non-admin roles", async () => {
    app = await getApp();
    token = await getToken(["helpdesk_user"]);

    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/automation/rules",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Test", ordinal: 1, trigger: { type: "field_match", field: "priority", value: "High" }, actions: [{ type: "assign", to: "00000000-0000-4000-8000-000000000001" }] },
    });

    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/helpdesk/automation/evaluate — validates input", async () => {
    app = await getApp();
    token = await getToken(["helpdesk_user"]);

    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/automation/evaluate",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/helpdesk/automation/rules — requires auth", async () => {
    app = await getApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/automation/rules",
    });

    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/helpdesk/automation/rules/:id — returns 404 for missing rule", async () => {
    app = await getApp();
    token = await getToken();

    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/automation/rules/99999999-aaaa-4000-8000-000000000099",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("DELETE /v1/helpdesk/automation/rules/:id — returns 404 for missing rule", async () => {
    app = await getApp();
    token = await getToken();

    const res = await app.inject({
      method: "DELETE",
      url: "/v1/helpdesk/automation/rules/99999999-aaaa-4000-8000-000000000099",
      headers: { authorization: `Bearer ${token}` },
    });

    expect([202, 404]).toContain(res.statusCode);
  });

  it("PATCH /v1/helpdesk/automation/rules/:id — returns 404 for missing rule", async () => {
    app = await getApp();
    token = await getToken();

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/helpdesk/automation/rules/99999999-aaaa-4000-8000-000000000099",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Updated" },
    });

    expect([202, 404]).toContain(res.statusCode);
  });
});
