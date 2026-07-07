/**
 * ITIL ticket types and CMDB linkage tests.
 *
 * Covers:
 * - Creating each ticket type (incident, problem, change)
 * - Type-specific required field validation
 * - Status transition validation (valid and invalid)
 * - CMDB asset linkage
 * - Graceful degradation when asset-service is unavailable
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import {
  isValidTransition,
  getInitialStatus,
  getStatusesForType,
  getValidNextStatuses,
  isValidStatusForType,
  validateTypeFields,
  getRequiredFieldNames,
  TICKET_TYPES,
  INCIDENT_STATUSES,
  PROBLEM_STATUSES,
  CHANGE_STATUSES,
} from "../src/modules/tickets/itil-domain.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000088";
const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const VALID_UUID = "11111111-2222-4000-8000-333333333333";

function token(roles: string[] = ["helpdesk_user"], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-001" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

// ══════════════════════════════════════════════════════════════════════════════
// ITIL DOMAIN — Pure Logic Tests
// ══════════════════════════════════════════════════════════════════════════════
describe("ITIL domain — ticket types", () => {
  it("defines three ticket types", () => {
    expect(TICKET_TYPES).toEqual(["incident", "problem", "change"]);
  });

  it("incident has correct statuses", () => {
    expect(INCIDENT_STATUSES).toEqual(["open", "investigating", "resolved", "closed"]);
  });

  it("problem has correct statuses", () => {
    expect(PROBLEM_STATUSES).toEqual(["identified", "root_cause", "fix_applied", "closed"]);
  });

  it("change has correct statuses", () => {
    expect(CHANGE_STATUSES).toEqual(["requested", "approved", "implemented", "reviewed", "closed"]);
  });
});

describe("ITIL domain — initial statuses", () => {
  it("incident starts at open", () => {
    expect(getInitialStatus("incident")).toBe("open");
  });

  it("problem starts at identified", () => {
    expect(getInitialStatus("problem")).toBe("identified");
  });

  it("change starts at requested", () => {
    expect(getInitialStatus("change")).toBe("requested");
  });
});

describe("ITIL domain — status validation", () => {
  it("validates statuses for incident type", () => {
    expect(isValidStatusForType("incident", "open")).toBe(true);
    expect(isValidStatusForType("incident", "investigating")).toBe(true);
    expect(isValidStatusForType("incident", "resolved")).toBe(true);
    expect(isValidStatusForType("incident", "closed")).toBe(true);
    expect(isValidStatusForType("incident", "root_cause")).toBe(false);
  });

  it("validates statuses for problem type", () => {
    expect(isValidStatusForType("problem", "identified")).toBe(true);
    expect(isValidStatusForType("problem", "root_cause")).toBe(true);
    expect(isValidStatusForType("problem", "fix_applied")).toBe(true);
    expect(isValidStatusForType("problem", "closed")).toBe(true);
    expect(isValidStatusForType("problem", "open")).toBe(false);
  });

  it("validates statuses for change type", () => {
    expect(isValidStatusForType("change", "requested")).toBe(true);
    expect(isValidStatusForType("change", "approved")).toBe(true);
    expect(isValidStatusForType("change", "implemented")).toBe(true);
    expect(isValidStatusForType("change", "reviewed")).toBe(true);
    expect(isValidStatusForType("change", "closed")).toBe(true);
    expect(isValidStatusForType("change", "open")).toBe(false);
  });
});

describe("ITIL domain — valid transitions (incident)", () => {
  it("open → investigating is valid", () => {
    expect(isValidTransition("incident", "open", "investigating")).toBe(true);
  });

  it("investigating → resolved is valid", () => {
    expect(isValidTransition("incident", "investigating", "resolved")).toBe(true);
  });

  it("resolved → closed is valid", () => {
    expect(isValidTransition("incident", "resolved", "closed")).toBe(true);
  });

  it("open → resolved is INVALID (must go through investigating)", () => {
    expect(isValidTransition("incident", "open", "resolved")).toBe(false);
  });

  it("open → closed is INVALID", () => {
    expect(isValidTransition("incident", "open", "closed")).toBe(false);
  });

  it("closed → open is INVALID (terminal state)", () => {
    expect(isValidTransition("incident", "closed", "open")).toBe(false);
  });

  it("investigating → open is INVALID (no backward)", () => {
    expect(isValidTransition("incident", "investigating", "open")).toBe(false);
  });
});

describe("ITIL domain — valid transitions (problem)", () => {
  it("identified → root_cause is valid", () => {
    expect(isValidTransition("problem", "identified", "root_cause")).toBe(true);
  });

  it("root_cause → fix_applied is valid", () => {
    expect(isValidTransition("problem", "root_cause", "fix_applied")).toBe(true);
  });

  it("fix_applied → closed is valid", () => {
    expect(isValidTransition("problem", "fix_applied", "closed")).toBe(true);
  });

  it("identified → closed is INVALID (must go through workflow)", () => {
    expect(isValidTransition("problem", "identified", "closed")).toBe(false);
  });

  it("identified → fix_applied is INVALID (skips root_cause)", () => {
    expect(isValidTransition("problem", "identified", "fix_applied")).toBe(false);
  });

  it("closed → identified is INVALID (terminal state)", () => {
    expect(isValidTransition("problem", "closed", "identified")).toBe(false);
  });
});

describe("ITIL domain — valid transitions (change)", () => {
  it("requested → approved is valid", () => {
    expect(isValidTransition("change", "requested", "approved")).toBe(true);
  });

  it("approved → implemented is valid", () => {
    expect(isValidTransition("change", "approved", "implemented")).toBe(true);
  });

  it("implemented → reviewed is valid", () => {
    expect(isValidTransition("change", "implemented", "reviewed")).toBe(true);
  });

  it("reviewed → closed is valid", () => {
    expect(isValidTransition("change", "reviewed", "closed")).toBe(true);
  });

  it("requested → implemented is INVALID (skips approval)", () => {
    expect(isValidTransition("change", "requested", "implemented")).toBe(false);
  });

  it("requested → closed is INVALID", () => {
    expect(isValidTransition("change", "requested", "closed")).toBe(false);
  });

  it("closed → requested is INVALID (terminal state)", () => {
    expect(isValidTransition("change", "closed", "requested")).toBe(false);
  });
});

describe("ITIL domain — getValidNextStatuses", () => {
  it("incident open can go to investigating", () => {
    expect(getValidNextStatuses("incident", "open")).toEqual(["investigating"]);
  });

  it("problem root_cause can go to fix_applied", () => {
    expect(getValidNextStatuses("problem", "root_cause")).toEqual(["fix_applied"]);
  });

  it("change closed has no next states", () => {
    expect(getValidNextStatuses("change", "closed")).toEqual([]);
  });

  it("returns empty for unknown status", () => {
    expect(getValidNextStatuses("incident", "bogus")).toEqual([]);
  });
});

describe("ITIL domain — type-specific required fields", () => {
  it("incident requires impactLevel and urgency", () => {
    expect(getRequiredFieldNames("incident")).toEqual(["impactLevel", "urgency"]);
  });

  it("problem requires symptomDescription", () => {
    expect(getRequiredFieldNames("problem")).toEqual(["symptomDescription"]);
  });

  it("change requires changeReason and riskAssessment", () => {
    expect(getRequiredFieldNames("change")).toEqual(["changeReason", "riskAssessment"]);
  });

  it("validates incident with all fields present", () => {
    const missing = validateTypeFields("incident", { impactLevel: "high", urgency: "critical" });
    expect(missing).toEqual([]);
  });

  it("reports missing incident fields", () => {
    const missing = validateTypeFields("incident", { impactLevel: "high" });
    expect(missing).toEqual(["urgency"]);
  });

  it("reports all missing when no fields provided", () => {
    const missing = validateTypeFields("incident", undefined);
    expect(missing).toEqual(["impactLevel", "urgency"]);
  });

  it("reports missing when field is empty string", () => {
    const missing = validateTypeFields("problem", { symptomDescription: "" });
    expect(missing).toEqual(["symptomDescription"]);
  });

  it("validates problem with all fields present", () => {
    const missing = validateTypeFields("problem", { symptomDescription: "Users report slow login" });
    expect(missing).toEqual([]);
  });

  it("validates change with all fields present", () => {
    const missing = validateTypeFields("change", { changeReason: "Upgrade server", riskAssessment: "Low risk" });
    expect(missing).toEqual([]);
  });

  it("reports missing change fields when empty object given", () => {
    const missing = validateTypeFields("change", {});
    expect(missing).toEqual(["changeReason", "riskAssessment"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CMDB — Asset Client Tests
// ══════════════════════════════════════════════════════════════════════════════
describe("CMDB asset client — graceful degradation", () => {
  it("never throws — always returns a result with verified=false on error", async () => {
    // The asset-client is designed to NEVER throw. When asset-service returns
    // a non-200 response or is unreachable, it returns verified=false.
    // In the test environment, asset-service returns 401 (no auth header forwarding),
    // which still results in graceful degradation (verified=false, no throw).
    const { verifyAsset } = await import("../src/modules/cmdb/asset-client.js");

    const result = await verifyAsset(VALID_UUID, TENANT);
    expect(result.verified).toBe(false);
    expect(result.assetId).toBe(VALID_UUID);
    // Error should be some form of non-OK response or unavailability
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
  });

  it("verifyAssets handles multiple asset IDs gracefully", async () => {
    const { verifyAssets } = await import("../src/modules/cmdb/asset-client.js");

    const results = await verifyAssets([VALID_UUID, "22222222-3333-4000-8000-444444444444"], TENANT);
    expect(results).toHaveLength(2);
    expect(results[0]!.verified).toBe(false);
    expect(results[1]!.verified).toBe(false);
    // Critical: NEVER throws, always returns results
    results.forEach((r) => {
      expect(r.error).toBeDefined();
    });
  });

  it("asset-client module exports the correct interface", async () => {
    const mod = await import("../src/modules/cmdb/asset-client.js");
    expect(typeof mod.verifyAsset).toBe("function");
    expect(typeof mod.verifyAssets).toBe("function");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROUTE-LEVEL INTEGRATION TESTS
// ══════════════════════════════════════════════════════════════════════════════
let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("POST /v1/helpdesk/tickets — ITIL types", () => {
  it("creates an incident ticket with type-specific fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: authHeader(["helpdesk_user"]),
      payload: {
        subject: "Server outage",
        ticketType: "incident",
        typeFields: { impactLevel: "high", urgency: "critical" },
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
  });

  it("creates a problem ticket with required fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: authHeader(["helpdesk_user"]),
      payload: {
        subject: "Recurring login failures",
        ticketType: "problem",
        typeFields: { symptomDescription: "Users report intermittent 500 errors on login" },
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("creates a change ticket with required fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: authHeader(["helpdesk_user"]),
      payload: {
        subject: "Upgrade database to v16",
        ticketType: "change",
        typeFields: { changeReason: "Performance improvement", riskAssessment: "Medium — requires downtime" },
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 422 when incident is missing required fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: authHeader(["helpdesk_user"]),
      payload: {
        subject: "Outage",
        ticketType: "incident",
        typeFields: { impactLevel: "high" }, // missing urgency
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("MISSING_TYPE_FIELDS");
    expect(res.json().message).toContain("urgency");
  });

  it("returns 422 when problem has no typeFields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: authHeader(["helpdesk_user"]),
      payload: {
        subject: "Some problem",
        ticketType: "problem",
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("MISSING_TYPE_FIELDS");
  });

  it("returns 422 when change has empty required fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: authHeader(["helpdesk_user"]),
      payload: {
        subject: "Change request",
        ticketType: "change",
        typeFields: { changeReason: "", riskAssessment: "" },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toContain("changeReason");
  });

  it("returns 400 for invalid ticketType", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: authHeader(["helpdesk_user"]),
      payload: {
        subject: "Invalid type",
        ticketType: "invalid_type",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("still allows legacy ticket creation without ticketType", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: authHeader(["helpdesk_user"]),
      payload: { subject: "Legacy ticket" },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("POST /v1/helpdesk/tickets — CMDB linkage", () => {
  it("accepts ticket with assetIds (graceful when asset-service unavailable)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: authHeader(["helpdesk_user"]),
      payload: {
        subject: "Printer broken",
        ticketType: "incident",
        typeFields: { impactLevel: "low", urgency: "low" },
        assetIds: [VALID_UUID],
      },
    });
    // Should accept even if asset-service is unavailable — graceful degradation
    expect(res.statusCode).toBe(202);
  });

  it("accepts ticket with multiple assetIds", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: authHeader(["helpdesk_user"]),
      payload: {
        subject: "Network switch failure",
        ticketType: "incident",
        typeFields: { impactLevel: "high", urgency: "critical" },
        assetIds: [VALID_UUID, "22222222-3333-4000-8000-444444444444"],
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 for invalid assetId format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: authHeader(["helpdesk_user"]),
      payload: {
        subject: "Bad asset",
        ticketType: "incident",
        typeFields: { impactLevel: "low", urgency: "low" },
        assetIds: ["not-a-uuid"],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/helpdesk/tickets/:id/transition", () => {
  it("returns 404 for non-existent ticket", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/helpdesk/tickets/${VALID_UUID}/transition`,
      headers: authHeader(["helpdesk_user"]),
      payload: { status: "investigating" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/helpdesk/tickets/${VALID_UUID}/transition`,
      headers: authHeader(["helpdesk_user"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty status", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/helpdesk/tickets/${VALID_UUID}/transition`,
      headers: authHeader(["helpdesk_user"]),
      payload: { status: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid ticket id", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets/not-a-uuid/transition",
      headers: authHeader(["helpdesk_user"]),
      payload: { status: "investigating" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/helpdesk/tickets/${VALID_UUID}/transition`,
      headers: authHeader(["citizen"]),
      payload: { status: "investigating" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/helpdesk/tickets/${VALID_UUID}/transition`,
      payload: { status: "investigating" },
    });
    expect(res.statusCode).toBe(401);
  });
});
