/** CAP-038 — comments CQRS route boundary (202 Accepted). */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerCommentsConsumers } from "../src/modules/comments/consumer.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c0510000-0000-4000-8000-000000000038";
const tok = (roles = ["case_manager"]) => signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "s" }, SECRET);

registerCommentsConsumers(queue);
await queue.start();

afterEach(async () => { await sqlAsTenant(TENANT, sql`DELETE FROM workflow.entity_comments WHERE tenant_id = ${TENANT}`); });
afterAll(async () => { await sqlClient.end(); });

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

describe("CAP-038 comments", () => {
  it("accepts create and threads replies after consumer apply", async () => {
    const app = await buildApp();
    const entityId = randomUUID();
    const base = { entityType: "case", entityId };
    const root = await app.inject({ method: "POST", url: "/v1/workflow/comments", headers: { authorization: `Bearer ${tok()}` }, payload: { ...base, body: "internal root", visibility: "internal" } });
    expect(root.statusCode).toBe(202);
    const rootId = root.json().id;
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/workflow/comments?entityType=case&entityId=${entityId}&viewer=internal`, headers: { authorization: `Bearer ${tok()}` } });
      const rows = g.json().data as Array<{ comment: { id: string } }>;
      return rows?.some((n) => n.comment.id === rootId) ? rows : null;
    });
    const reply = await app.inject({ method: "POST", url: "/v1/workflow/comments", headers: { authorization: `Bearer ${tok()}` }, payload: { ...base, parentCommentId: rootId, body: "reply", visibility: "external" } });
    expect(reply.statusCode).toBe(202);
    await app.inject({ method: "POST", url: "/v1/workflow/comments", headers: { authorization: `Bearer ${tok()}` }, payload: { ...base, body: "external note", visibility: "external" } });

    const internalView = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/workflow/comments?entityType=case&entityId=${entityId}&viewer=internal`, headers: { authorization: `Bearer ${tok()}` } });
      const roots = g.json().data as Array<{ comment: { id: string }; replies: unknown[] }>;
      return roots?.length >= 2 ? roots : null;
    });
    const rootNode = internalView.find((n) => n.comment.id === rootId);
    expect(rootNode?.replies.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it("404s when replying to a comment on a different entity", async () => {
    const app = await buildApp();
    const c = await app.inject({ method: "POST", url: "/v1/workflow/comments", headers: { authorization: `Bearer ${tok()}` }, payload: { entityType: "case", entityId: randomUUID(), body: "x" } });
    expect(c.statusCode).toBe(202);
    const commentId = c.json().id;
    await waitFor(async () => {
      // parent must exist before cross-entity reply pre-check can 404 vs race
      const found = await sqlAsTenant(TENANT, sql`SELECT id FROM workflow.entity_comments WHERE id = ${commentId}`);
      return found.length ? found : null;
    });
    const bad = await app.inject({ method: "POST", url: "/v1/workflow/comments", headers: { authorization: `Bearer ${tok()}` }, payload: { entityType: "case", entityId: randomUUID(), parentCommentId: commentId, body: "y" } });
    expect(bad.statusCode).toBe(404);
    await app.close();
  });
});
