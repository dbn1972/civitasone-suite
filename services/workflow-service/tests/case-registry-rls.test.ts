/** CAP-031 — registry idempotency + timeline + cross-tenant RLS isolation. */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T1 = "c1050000-0000-4000-8000-000000000131";
const T2 = "c1050000-0000-4000-8000-000000000132";
const tok = (tid: string) => signToken({ sub: randomUUID(), tid, roles: ["case_manager"], sid: "s" }, SECRET);

afterEach(async () => {
  for (const t of [T1, T2]) {
    await sqlAsTenant(t, sql`DELETE FROM workflow.entity_comments WHERE tenant_id = ${t}`);
    await sqlAsTenant(t, sql`DELETE FROM workflow.cases WHERE tenant_id = ${t}`);
    await sqlAsTenant(t, sql`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`).catch(() => undefined);
  }
});
afterAll(async () => { await sqlClient.end(); });

describe("CAP-031 registry", () => {
  it("registration is idempotent on (source_service, source_ref_id)", async () => {
    const app = await buildApp();
    const sourceRefId = randomUUID();
    const payload = { title: "Court case", caseType: "court_case", sourceService: "court", sourceRefId };
    const first = await app.inject({ method: "POST", url: "/v1/workflow/cases", headers: { authorization: `Bearer ${tok(T1)}` }, payload });
    expect(first.statusCode).toBe(201);
    const dup = await app.inject({ method: "POST", url: "/v1/workflow/cases", headers: { authorization: `Bearer ${tok(T1)}` }, payload });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().data.created).toBe(false);
    expect(dup.json().data.id).toBe(first.json().data.id);
    await app.close();
  });

  it("RLS isolates cases across tenants", async () => {
    const app = await buildApp();
    const ref = randomUUID();
    await app.inject({ method: "POST", url: "/v1/workflow/cases", headers: { authorization: `Bearer ${tok(T1)}` }, payload: { title: "T1 case", caseType: "generic", sourceService: "test", sourceRefId: ref } });
    const listT2 = await app.inject({ method: "GET", url: "/v1/workflow/cases", headers: { authorization: `Bearer ${tok(T2)}` } });
    expect(listT2.json().data.every((c: { title: string }) => c.title !== "T1 case")).toBe(true);
    const listT1 = await app.inject({ method: "GET", url: "/v1/workflow/cases", headers: { authorization: `Bearer ${tok(T1)}` } });
    expect(listT1.json().data.some((c: { title: string }) => c.title === "T1 case")).toBe(true);
    await app.close();
  });

  it("timeline merges comments for an entity", async () => {
    const app = await buildApp();
    const entityId = randomUUID();
    await app.inject({ method: "POST", url: "/v1/workflow/comments", headers: { authorization: `Bearer ${tok(T1)}` }, payload: { entityType: "case", entityId, body: "first" } });
    await app.inject({ method: "POST", url: "/v1/workflow/comments", headers: { authorization: `Bearer ${tok(T1)}` }, payload: { entityType: "case", entityId, body: "second" } });
    const tl = await app.inject({ method: "GET", url: `/v1/workflow/timeline?entityType=case&entityId=${entityId}`, headers: { authorization: `Bearer ${tok(T1)}` } });
    expect(tl.json().meta.total).toBe(2);
    expect(tl.json().data[0].source).toBe("comment");
    await app.close();
  });
});
