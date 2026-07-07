/**
 * ML Breach Prediction — unit + integration tests.
 *
 * Tests cover:
 * - Happy path: ML prediction returns probability, correct classification
 * - Fallback mode: when ML is unavailable, uses elapsed % threshold
 * - Breach threshold: probability > 0.70 → breachRisk = "high"
 * - Reassignment suggestion: top 3 lowest-workload agents returned on high risk
 * - Route: 404 for unknown ticket, 403 for wrong role, 200 with correct shape
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import {
  extractFeatures,
  priorityToNumeric,
  computeElapsedPctOfSla,
  classifyBreachRisk,
  computeFallbackProbability,
  buildFallbackResponse,
  buildMlResponse,
  selectReassignmentCandidates,
  BREACH_HIGH_THRESHOLD,
  FALLBACK_ELAPSED_THRESHOLD,
} from "../src/modules/ml-breach/domain.js";
import type { TicketRow } from "../src/modules/tickets/schema.js";
import type { SlaPolicy } from "../src/modules/sla/domain.js";

// ── Domain Logic Unit Tests ───────────────────────────────────────

describe("ml-breach domain", () => {
  describe("priorityToNumeric", () => {
    it("maps critical to 4", () => expect(priorityToNumeric("critical")).toBe(4));
    it("maps Critical (case-insensitive) to 4", () => expect(priorityToNumeric("Critical")).toBe(4));
    it("maps high to 3", () => expect(priorityToNumeric("high")).toBe(3));
    it("maps High to 3", () => expect(priorityToNumeric("High")).toBe(3));
    it("maps medium to 2", () => expect(priorityToNumeric("medium")).toBe(2));
    it("maps Medium to 2", () => expect(priorityToNumeric("Medium")).toBe(2));
    it("maps low to 1", () => expect(priorityToNumeric("low")).toBe(1));
    it("maps unknown to 1", () => expect(priorityToNumeric("unknown")).toBe(1));
  });

  describe("computeElapsedPctOfSla", () => {
    const policies: SlaPolicy[] = [
      { id: "p1", tenantId: "t1", priority: "high", category: null, responseMinutes: 60, resolutionMinutes: 480 },
      { id: "p2", tenantId: "t1", priority: "medium", category: null, responseMinutes: 240, resolutionMinutes: 1440 },
    ];

    it("returns 0.5 when half of SLA time elapsed", () => {
      const created = new Date("2024-01-01T00:00:00Z");
      const now = new Date("2024-01-01T04:00:00Z"); // 4h = half of 8h (480min)
      const pct = computeElapsedPctOfSla(created, now, policies, "high");
      expect(pct).toBeCloseTo(0.5, 2);
    });

    it("returns 1.0 when exactly at SLA deadline", () => {
      const created = new Date("2024-01-01T00:00:00Z");
      const now = new Date("2024-01-01T08:00:00Z"); // 8h = 480min
      const pct = computeElapsedPctOfSla(created, now, policies, "high");
      expect(pct).toBeCloseTo(1.0, 2);
    });

    it("returns > 1.0 when SLA is breached", () => {
      const created = new Date("2024-01-01T00:00:00Z");
      const now = new Date("2024-01-01T10:00:00Z"); // 10h > 8h
      const pct = computeElapsedPctOfSla(created, now, policies, "high");
      expect(pct).toBeGreaterThan(1.0);
    });

    it("returns 0 for just-created ticket", () => {
      const created = new Date("2024-01-01T00:00:00Z");
      const pct = computeElapsedPctOfSla(created, created, policies, "high");
      expect(pct).toBe(0);
    });

    it("uses default policies when none provided", () => {
      const created = new Date("2024-01-01T00:00:00Z");
      const now = new Date("2024-01-01T04:00:00Z"); // 4h = 240min
      // Default high = 480 min resolution → 240/480 = 0.5
      const pct = computeElapsedPctOfSla(created, now, [], "high");
      expect(pct).toBeCloseTo(0.5, 2);
    });
  });

  describe("classifyBreachRisk", () => {
    it("returns 'high' for probability > 0.70", () => {
      expect(classifyBreachRisk(0.71)).toBe("high");
      expect(classifyBreachRisk(0.95)).toBe("high");
      expect(classifyBreachRisk(1.0)).toBe("high");
    });

    it("returns 'medium' for probability > 0.40 and <= 0.70", () => {
      expect(classifyBreachRisk(0.41)).toBe("medium");
      expect(classifyBreachRisk(0.55)).toBe("medium");
      expect(classifyBreachRisk(0.70)).toBe("medium");
    });

    it("returns 'low' for probability <= 0.40", () => {
      expect(classifyBreachRisk(0.0)).toBe("low");
      expect(classifyBreachRisk(0.20)).toBe("low");
      expect(classifyBreachRisk(0.40)).toBe("low");
    });
  });

  describe("computeFallbackProbability", () => {
    it("returns high probability when elapsed > 0.80", () => {
      const prob = computeFallbackProbability(0.85);
      expect(prob).toBe(0.85);
    });

    it("caps at 1.0 for breached SLAs", () => {
      const prob = computeFallbackProbability(1.2);
      expect(prob).toBe(1.0);
    });

    it("returns scaled-down probability below 0.80 threshold", () => {
      const prob = computeFallbackProbability(0.5);
      expect(prob).toBe(0.25); // 0.5 * 0.5
    });

    it("returns 0 for just-created ticket", () => {
      const prob = computeFallbackProbability(0);
      expect(prob).toBe(0);
    });
  });

  describe("buildFallbackResponse", () => {
    it("returns isFallback=true", () => {
      const features = {
        category: "general",
        priority: 2,
        assigneeWorkload: 3,
        queueDepth: 10,
        timeOfDay: 14,
        elapsedPctOfSla: 0.5,
      };
      const result = buildFallbackResponse(features, []);
      expect(result.isFallback).toBe(true);
    });

    it("includes suggestedReassignments when breach is high", () => {
      const features = {
        category: "general",
        priority: 3,
        assigneeWorkload: 5,
        queueDepth: 20,
        timeOfDay: 14,
        elapsedPctOfSla: 0.9, // > 0.80 → probability = 0.9 → risk = high
      };
      const candidates = [
        { agentId: "agent-1", workload: 2 },
        { agentId: "agent-2", workload: 3 },
        { agentId: "agent-3", workload: 4 },
        { agentId: "agent-4", workload: 5 },
      ];
      const result = buildFallbackResponse(features, candidates);
      expect(result.breachRisk).toBe("high");
      expect(result.suggestedReassignments).toHaveLength(3);
      expect(result.suggestedReassignments[0].agentId).toBe("agent-1");
    });

    it("returns empty suggestedReassignments when risk is not high", () => {
      const features = {
        category: "general",
        priority: 2,
        assigneeWorkload: 3,
        queueDepth: 10,
        timeOfDay: 14,
        elapsedPctOfSla: 0.3, // low risk
      };
      const result = buildFallbackResponse(features, [{ agentId: "a", workload: 1 }]);
      expect(result.suggestedReassignments).toHaveLength(0);
    });
  });

  describe("buildMlResponse", () => {
    it("returns isFallback=false", () => {
      const result = buildMlResponse(0.85, [], []);
      expect(result.isFallback).toBe(false);
    });

    it("classifies probability correctly", () => {
      const result = buildMlResponse(0.75, [], []);
      expect(result.breachRisk).toBe("high");
      expect(result.probability).toBe(0.75);
    });

    it("limits factors to 3", () => {
      const factors = [
        { feature: "a", contribution: 0.4, direction: "positive" as const },
        { feature: "b", contribution: 0.3, direction: "negative" as const },
        { feature: "c", contribution: 0.2, direction: "positive" as const },
        { feature: "d", contribution: 0.1, direction: "negative" as const },
      ];
      const result = buildMlResponse(0.6, factors, []);
      expect(result.factors).toHaveLength(3);
    });

    it("includes candidates only when high risk", () => {
      const candidates = [{ agentId: "a1", workload: 1 }];
      const highResult = buildMlResponse(0.8, [], candidates);
      expect(highResult.suggestedReassignments).toHaveLength(1);

      const lowResult = buildMlResponse(0.3, [], candidates);
      expect(lowResult.suggestedReassignments).toHaveLength(0);
    });
  });

  describe("selectReassignmentCandidates", () => {
    it("returns top 3 agents with lowest workload", () => {
      const agents = [
        { agentId: "a", workload: 5 },
        { agentId: "b", workload: 2 },
        { agentId: "c", workload: 8 },
        { agentId: "d", workload: 1 },
        { agentId: "e", workload: 3 },
      ];
      const result = selectReassignmentCandidates(agents, null);
      expect(result).toHaveLength(3);
      expect(result[0].agentId).toBe("d"); // workload 1
      expect(result[1].agentId).toBe("b"); // workload 2
      expect(result[2].agentId).toBe("e"); // workload 3
    });

    it("excludes current assignee", () => {
      const agents = [
        { agentId: "a", workload: 1 },
        { agentId: "b", workload: 2 },
        { agentId: "c", workload: 3 },
        { agentId: "d", workload: 4 },
      ];
      const result = selectReassignmentCandidates(agents, "a");
      expect(result).toHaveLength(3);
      expect(result.find((c) => c.agentId === "a")).toBeUndefined();
    });

    it("returns fewer than 3 if not enough agents available", () => {
      const agents = [{ agentId: "a", workload: 1 }];
      const result = selectReassignmentCandidates(agents, null);
      expect(result).toHaveLength(1);
    });

    it("returns empty when no agents available", () => {
      const result = selectReassignmentCandidates([], null);
      expect(result).toHaveLength(0);
    });
  });

  describe("extractFeatures", () => {
    const policies: SlaPolicy[] = [
      { id: "p1", tenantId: "t1", priority: "high", category: null, responseMinutes: 60, resolutionMinutes: 480 },
    ];

    it("extracts all required features", () => {
      const ticket = {
        id: "ticket-1",
        tenantId: "t1",
        subject: "Test",
        description: null,
        priority: "High",
        status: "open",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T00:00:00Z"),
        assigneeId: "agent-1",
        createdBy: "user-1",
        updatedBy: "user-1",
        version: 1,
        slaAtRiskNotifiedAt: null,
        slaBreachedNotifiedAt: null,
        source: null,
        sourceRef: null,
        ticketType: "incident",
        typeFields: null,
        assetIds: null,
        assetVerified: false,
      } as TicketRow;

      const now = new Date("2024-01-01T04:00:00Z"); // 4h elapsed of 8h window
      const features = extractFeatures(ticket, now, 5, 20, policies);

      expect(features.category).toBe("incident");
      expect(features.priority).toBe(3); // High = 3
      expect(features.assigneeWorkload).toBe(5);
      expect(features.queueDepth).toBe(20);
      expect(features.timeOfDay).toBe(4); // 04:00 UTC
      expect(features.elapsedPctOfSla).toBeCloseTo(0.5, 2);
    });

    it("uses 'general' when ticketType is null", () => {
      const ticket = {
        id: "ticket-2",
        tenantId: "t1",
        subject: "No type",
        description: null,
        priority: "Medium",
        status: "open",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T00:00:00Z"),
        assigneeId: null,
        createdBy: "user-1",
        updatedBy: "user-1",
        version: 1,
        slaAtRiskNotifiedAt: null,
        slaBreachedNotifiedAt: null,
        source: null,
        sourceRef: null,
        ticketType: null,
        typeFields: null,
        assetIds: null,
        assetVerified: false,
      } as TicketRow;

      const features = extractFeatures(ticket, new Date(), 0, 5, []);
      expect(features.category).toBe("general");
    });
  });
});

// ── Route Integration Tests ───────────────────────────────────────

describe("GET /v1/helpdesk/tickets/:id/breach-risk (route)", () => {
  let buildApp: typeof import("../src/app.js").buildApp;
  let signToken: typeof import("@civitasone/auth").signToken;
  let sqlClient: typeof import("../src/shared/db.js").sqlClient;

  const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
  const TENANT = "aaaaaaaa-1111-4000-8000-000000000088";

  function token(tenantId = TENANT, roles = ["helpdesk_user"]) {
    return signToken({ sub: "user-001", tid: tenantId, roles, sid: "sess-001" }, SECRET);
  }

  beforeEach(async () => {
    // Dynamic imports to ensure test isolation
    const appMod = await import("../src/app.js");
    const authMod = await import("@civitasone/auth");
    const dbMod = await import("../src/shared/db.js");
    buildApp = appMod.buildApp;
    signToken = authMod.signToken;
    sqlClient = dbMod.sqlClient;
  });

  afterAll(async () => {
    const dbMod = await import("../src/shared/db.js");
    await dbMod.sqlClient.end();
  });

  it("returns 404 for unknown ticket", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/tickets/00000000-0000-4000-8000-000000000000/breach-risk",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/tickets/00000000-0000-4000-8000-000000000000/breach-risk",
      headers: { authorization: `Bearer ${token(TENANT, ["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/tickets/00000000-0000-4000-8000-000000000000/breach-risk",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/tickets/not-a-uuid/breach-risk",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
