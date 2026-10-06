/**
 * GAP-KNOWLEDGE-DOCUMENTS-NEW-01: POST /v1/knowledge/documents must accept and
 *   persist a publisher-chosen accessLevel (least-privilege default "internal",
 *   enforced server-side via the zod enum), instead of silently always
 *   "internal".
 * GAP-KNOWLEDGE-DOCUMENTS-NEW-05: title is validated (max 200, trimmed) and a
 *   successful create emits a document.created event + an audit event (via the
 *   consumer/outbox). An invalid accessLevel is rejected with 400.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerDocumentsConsumers } from "../src/modules/documents/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = randomUUID();
const ACTOR = "cccccccc-0000-4000-8000-00000000d001";

function tok(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-new01" }, SECRET, 3600);
}
const adminTok = tok(["knowledge_admin"]);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  // The create consumer that performs the INSERT is normally only registered in
  // worker.ts; register it on the same in-memory queue here so the async CQRS
  // command is actually applied before we read the row back.
  registerDocumentsConsumers(queue);
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GAP-KNOWLEDGE-DOCUMENTS-NEW-01 — accessLevel is persisted", () => {
  it("creates a document with a publisher-chosen accessLevel=restricted", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/knowledge/documents",
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { title: "Confidential Circular", category: "Circular", accessLevel: "restricted" },
    });
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { data?: { id?: string }; id?: string }).data?.id ?? (res.json() as { id?: string }).id!;
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();

    const row = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      const rows = await sql`SELECT access_level FROM knowledge.documents WHERE id = ${id} AND tenant_id = ${TENANT}`;
      return (rows as unknown as Array<{ access_level: string }>)[0];
    });
    expect(row?.access_level).toBe("restricted");
  });

  it("defaults accessLevel to internal when omitted", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/knowledge/documents",
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { title: "Plain Doc", category: "Policy" },
    });
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { data?: { id?: string }; id?: string }).data?.id ?? (res.json() as { id?: string }).id!;
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();

    const row = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      const rows = await sql`SELECT access_level FROM knowledge.documents WHERE id = ${id} AND tenant_id = ${TENANT}`;
      return (rows as unknown as Array<{ access_level: string }>)[0];
    });
    expect(row?.access_level).toBe("internal");
  });
});

describe("GAP-KNOWLEDGE-DOCUMENTS-NEW-05 — validation + audit", () => {
  it("rejects an invalid accessLevel with 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/knowledge/documents",
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { title: "Bad", accessLevel: "top-secret" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a title longer than 200 chars with 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/knowledge/documents",
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { title: "x".repeat(201) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("emits a document.created audit event in the outbox on success", async () => {
    const marker = `audit-${randomUUID().slice(0, 8)}`;
    const res = await app.inject({
      method: "POST", url: "/v1/knowledge/documents",
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { title: marker, category: "Circular", accessLevel: "internal" },
    });
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { data?: { id?: string }; id?: string }).data?.id ?? (res.json() as { id?: string }).id!;
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();

    // The consumer enqueues an audit event (topic audit.event.record) into the
    // transactional outbox in the same tx as the insert.
    const audits = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      const rows = await sql`
        SELECT topic, payload FROM _outbox.messages
        WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'
        ORDER BY created_at DESC LIMIT 20`;
      return rows as unknown as Array<{ topic: string; payload: Record<string, unknown> }>;
    });
    const match = audits.find((a) => {
      const p = a.payload as { resourceId?: string; action?: string; resourceType?: string };
      return p.resourceId === id && p.action === "create" && p.resourceType === "document";
    });
    expect(match).toBeDefined();
  });
});
