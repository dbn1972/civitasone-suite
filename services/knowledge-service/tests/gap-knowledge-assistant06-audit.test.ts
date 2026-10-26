/**
 * GAP-KNOWLEDGE-ASSISTANT-06 (audit slice): every assistant ask writes one
 * audit event in the same transaction as the interaction row. The audit
 * payload must reference the interaction id and must NOT carry the free-text
 * question (DPDP: no personal data in the audit trail).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const USER = "cccccccc-0000-4000-8000-00000000b002";
const userTok = signToken({ sub: USER, tid: TENANT, roles: ["knowledge_user"], sid: "sess" }, SECRET, 3600);

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GAP-KNOWLEDGE-ASSISTANT-06 per-interaction audit", () => {
  it("emits one audit.event.record per ask, keyed by interaction id, without question text", async () => {
    const ask = await app.inject({
      method: "POST", url: "/v1/knowledge/assistant/ask",
      headers: { authorization: `Bearer ${userTok}`, "content-type": "application/json" },
      payload: { question: "my Aadhaar 1234 5678 9012 how do I apply for leave" },
    });
    expect(ask.statusCode).toBe(200);
    const interactionId = (ask.json() as { data: { interactionId: string } }).data.interactionId;

    const rows = await sqlClient.begin(async (q) => {
      await q`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return q<Array<{ actor_id: string; payload: unknown }>>`
        SELECT actor_id, payload FROM _outbox.messages
        WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'`;
    });
    const events = rows.map((r) => ({
      actorId: r.actor_id,
      payload: (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>,
    })).filter((e) => e.payload.resourceId === interactionId);

    expect(events).toHaveLength(1);
    expect(events[0]!.actorId).toBe(USER);
    expect(events[0]!.payload).toMatchObject({
      service: "knowledge", action: "ask", resourceType: "assistant_interaction", outcome: "success",
    });
    expect(JSON.stringify(events[0]!.payload)).not.toContain("1234 5678 9012");
    expect(JSON.stringify(events[0]!.payload)).not.toContain("leave");
  });
});
