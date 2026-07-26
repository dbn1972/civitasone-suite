/** CAP-038 — comments over HTTP + DB: threading + visibility. */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c0510000-0000-4000-8000-000000000038";
const tok = (roles = ["case_manager"]) => signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "s" }, SECRET);

afterEach(async () => { await sqlAsTenant(TENANT, sql`DELETE FROM workflow.entity_comments WHERE tenant_id = ${TENANT}`); });
afterAll(async () => { await sqlClient.end(); });

describe("CAP-038 comments", () => {
  it("threads replies and filters by visibility", async () => {
    const app = await buildApp();
    const entityId = randomUUID();
    const base = { entityType: "case", entityId };
    const root = await app.inject({ method: "POST", url: "/v1/workflow/comments", headers: { authorization: `Bearer ${tok()}` }, payload: { ...base, body: "internal root", visibility: "internal" } });
    const rootId = root.json().data.id;
    await app.inject({ method: "POST", url: "/v1/workflow/comments", headers: { authorization: `Bearer ${tok()}` }, payload: { ...base, parentCommentId: rootId, body: "reply", visibility: "external" } });
    await app.inject({ method: "POST", url: "/v1/workflow/comments", headers: { authorization: `Bearer ${tok()}` }, payload: { ...base, body: "external note", visibility: "external" } });

    const internalView = await app.inject({ method: "GET", url: `/v1/workflow/comments?entityType=case&entityId=${entityId}&viewer=internal`, headers: { authorization: `Bearer ${tok()}` } });
    const roots = internalView.json().data;
    expect(roots).toHaveLength(2); // root + external note at top level
    const rootNode = roots.find((n: { comment: { id: string } }) => n.comment.id === rootId);
    expect(rootNode.replies).toHaveLength(1);

    const externalView = await app.inject({ method: "GET", url: `/v1/workflow/comments?entityType=case&entityId=${entityId}&viewer=external`, headers: { authorization: `Bearer ${tok()}` } });
    // external viewer: sees the external reply (promoted) + the external note = 2, never the internal root
    expect(externalView.json().data.every((n: { comment: { visibility: string } }) => n.comment.visibility === "external")).toBe(true);
    await app.close();
  });

  it("404s when replying to a comment on a different entity", async () => {
    const app = await buildApp();
    const c = await app.inject({ method: "POST", url: "/v1/workflow/comments", headers: { authorization: `Bearer ${tok()}` }, payload: { entityType: "case", entityId: randomUUID(), body: "x" } });
    const bad = await app.inject({ method: "POST", url: "/v1/workflow/comments", headers: { authorization: `Bearer ${tok()}` }, payload: { entityType: "case", entityId: randomUUID(), parentCommentId: c.json().data.id, body: "y" } });
    expect(bad.statusCode).toBe(404);
    await app.close();
  });
});
