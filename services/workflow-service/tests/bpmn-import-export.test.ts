/**
 * BPMN 2.0 Import/Export — route coverage tests.
 *
 * Covers: POST /v1/workflow/definitions/import, GET /v1/workflow/definitions/:id/bpmn.
 * Validates auth, role gates, validation, import parsing, and export generation.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient, db } from "../src/shared/db.js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { seedDefinition, cleanup } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-2222-4000-8000-000000000099";
const UNKNOWN_ID = "00000000-dead-4000-8000-000000000002";
const ACTOR_ID = "00000000-0001-4000-8000-000000000001";

function makeToken(roles: string[] = ["workflow_admin"], sub = ACTOR_ID) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

const SAMPLE_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="def_1">
  <process id="Process_1" name="Leave Approval" isExecutable="true">
    <startEvent id="start_1" name="Request Submitted" />
    <userTask id="task_review" name="Manager Review" />
    <exclusiveGateway id="gw_1" name="Decision" />
    <userTask id="task_approve" name="Approve" />
    <userTask id="task_reject" name="Reject" />
    <endEvent id="end_1" name="Done" />
    <sequenceFlow id="f1" sourceRef="start_1" targetRef="task_review" />
    <sequenceFlow id="f2" sourceRef="task_review" targetRef="gw_1" />
    <sequenceFlow id="f3" sourceRef="gw_1" targetRef="task_approve" name="Yes" />
    <sequenceFlow id="f4" sourceRef="gw_1" targetRef="task_reject" name="No" />
    <sequenceFlow id="f5" sourceRef="task_approve" targetRef="end_1" />
    <sequenceFlow id="f6" sourceRef="task_reject" targetRef="end_1" />
  </process>
</definitions>`;

const tenants: string[] = [];
function trackTenant(t: string) { tenants.push(t); return t; }

afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

// ── POST /v1/workflow/definitions/import ─────────────────────────────────────

describe("POST /v1/workflow/definitions/import", () => {
  it("imports valid BPMN XML and creates a draft definition", async () => {
    trackTenant(TENANT);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions/import",
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { xml: SAMPLE_BPMN, name: "My Leave Flow" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.status).toBe("draft");
    expect(body.data.name).toBe("My Leave Flow");
    expect(body.data.nodeCount).toBe(6); // start, 2 tasks, gateway, 2 tasks, end = 6
    expect(body.data.edgeCount).toBe(6);
    expect(body.data.version).toBe(1);
  });

  it("uses process name from XML when no name provided", async () => {
    trackTenant(TENANT);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions/import",
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { xml: SAMPLE_BPMN },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.name).toBe("Leave Approval");
  });

  it("returns 400 for empty/invalid BPMN XML (no process elements)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions/import",
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { xml: '<?xml version="1.0" encoding="UTF-8"?><definitions xmlns="urn:test"></definitions>' },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_BPMN");
  });

  it("returns 400 for XML too short", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions/import",
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { xml: "<short/>" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions/import",
      payload: { xml: SAMPLE_BPMN },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions/import",
      headers: { authorization: `Bearer ${makeToken(["workflow_user"])}` },
      payload: { xml: SAMPLE_BPMN },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/workflow/definitions/:id/bpmn ────────────────────────────────────

describe("GET /v1/workflow/definitions/:id/bpmn", () => {
  it("exports an existing definition as BPMN XML", async () => {
    const tenantId = trackTenant(TENANT);
    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "start", sortOrder: 1 },
      { nodeKey: "review", name: "Review", nodeType: "task", sortOrder: 2 },
      { nodeKey: "end", name: "End", nodeType: "end", sortOrder: 3 },
    ], [
      { fromNode: "start", toNode: "review", sortOrder: 1 },
      { fromNode: "review", toNode: "end", sortOrder: 1 },
    ]);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/definitions/${def.id}/bpmn`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    const xml = res.body;
    expect(xml).toContain("<?xml");
    expect(xml).toContain("<definitions");
    expect(xml).toContain("<process");
    expect(xml).toContain("startEvent");
    expect(xml).toContain("endEvent");
    expect(xml).toContain("sequenceFlow");
  });

  it("returns 404 for non-existent definition", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/definitions/${UNKNOWN_ID}/bpmn`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/definitions/${UNKNOWN_ID}/bpmn`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/definitions/${UNKNOWN_ID}/bpmn`,
      headers: { authorization: `Bearer ${makeToken(["workflow_user"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid UUID param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/definitions/not-uuid/bpmn",
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
