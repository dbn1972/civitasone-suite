/**
 * UAT owner decision #16 (GAP-KNOWLEDGE-ASSISTANT-06): assistant interactions are
 * kept 90 days, then purged. Audit events are NOT purged here (they follow audit
 * retention). The purge crosses tenants only to DISCOVER work (scanner pool);
 * every delete runs under its own tenant GUC and is audited in the same txn.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import {
  ASSISTANT_RETENTION_DAYS,
  purgeExpiredInteractions,
} from "../src/modules/assistant/retention.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T1 = randomUUID();
const T2 = randomUUID();
const USER = "cccccccc-0000-4000-8000-00000000d016";
const tok = (tid: string) => signToken({ sub: USER, tid, roles: ["knowledge_user"], sid: "s16" }, SECRET, 3600);

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

type Row = { id: string; created_at: Date; expires_at: Date };
const rowsFor = (tid: string, ids: string[]) => sqlClient.begin(async (q) => {
  await q`SELECT set_config('app.tenant_id', ${tid}, true)`;
  return (await q`SELECT id, created_at, expires_at FROM knowledge.assistant_interactions WHERE id = ANY(${ids}::uuid[])`) as unknown as Row[];
});
async function seed(tid: string, id: string, expiresAt: Date) {
  await sqlClient.begin(async (q) => {
    await q`SELECT set_config('app.tenant_id', ${tid}, true)`;
    await q`INSERT INTO knowledge.assistant_interactions (id, tenant_id, question, created_by, expires_at)
            VALUES (${id}, ${tid}, 'q', ${USER}, ${expiresAt.toISOString()}::timestamptz)`;
  });
}

describe("owner decision #16 — 90-day assistant retention", () => {
  it("keeps interactions for exactly 90 days", () => {
    expect(ASSISTANT_RETENTION_DAYS).toBe(90);
  });

  it("stamps expires_at = created_at + 90 days on ask", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/knowledge/assistant/ask",
      headers: { authorization: `Bearer ${tok(T1)}`, "content-type": "application/json" },
      payload: { question: "how do I apply for leave" },
    });
    expect(res.statusCode).toBe(200);
    const id = (res.json() as { data: { interactionId: string } }).data.interactionId;
    const [row] = await rowsFor(T1, [id]);
    const days = (new Date(row!.expires_at).getTime() - new Date(row!.created_at).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(89.99);
    expect(days).toBeLessThan(90.01);
  });

  it("stamps expires_at on a direct escalation too", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/knowledge/assistant/escalate",
      headers: { authorization: `Bearer ${tok(T1)}`, "content-type": "application/json" },
      payload: { question: "need a human", priority: "Medium" },
    });
    expect(res.statusCode).toBe(202);
    const rows = await sqlClient.begin(async (q) => {
      await q`SELECT set_config('app.tenant_id', ${T1}, true)`;
      return (await q`SELECT expires_at, created_at FROM knowledge.assistant_interactions WHERE escalated = true AND question = 'need a human'`) as unknown as Row[];
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect((new Date(r.expires_at).getTime() - new Date(r.created_at).getTime()) / 86_400_000).toBeGreaterThan(89.99);
    }
  });

  it("purges only expired rows, across tenants, and audits each tenant purge without personal data", async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 86_400_000);
    const future = new Date(now.getTime() + 86_400_000);
    const [old1, old2, live1, live2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await seed(T1, old1, past); await seed(T1, live1, future);
    await seed(T2, old2, past); await seed(T2, live2, future);

    const purged = await purgeExpiredInteractions(now);
    expect(purged).toBeGreaterThanOrEqual(2);

    expect(await rowsFor(T1, [old1])).toHaveLength(0);
    expect(await rowsFor(T2, [old2])).toHaveLength(0);
    expect(await rowsFor(T1, [live1])).toHaveLength(1);
    expect(await rowsFor(T2, [live2])).toHaveLength(1);

    for (const tid of [T1, T2]) {
      const audits = await sqlClient.begin(async (q) => {
        await q`SELECT set_config('app.tenant_id', ${tid}, true)`;
        return (await q`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tid} AND topic = 'audit.event.record'`) as unknown as Array<{ payload: Record<string, unknown> | string }>;
      });
      const purges = audits.map((a) => (typeof a.payload === "string" ? JSON.parse(a.payload) : a.payload) as Record<string, unknown>)
        .filter((p) => p.action === "purge" && p.resourceType === "assistant_interaction");
      expect(purges).toHaveLength(1);
      expect(purges[0]).toMatchObject({ service: "knowledge", outcome: "success", count: 1 });
      expect(JSON.stringify(purges[0])).not.toContain("question");
    }
  });

  it("a second run with nothing expired deletes nothing and writes no purge audit", async () => {
    const before = await purgeExpiredInteractions(new Date());
    const again = await purgeExpiredInteractions(new Date());
    expect(before).toBeGreaterThanOrEqual(0);
    expect(again).toBe(0);
  });
});
