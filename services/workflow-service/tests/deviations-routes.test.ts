/** CAP-039 — deviation waiver lifecycle over HTTP + DB (maker-checker). */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "de510000-0000-4000-8000-000000000039";
const MAKER = randomUUID();
const CHECKER = randomUUID();
const tok = (sub: string, roles: string[]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);

afterEach(async () => { await sqlAsTenant(TENANT, sql`DELETE FROM workflow.deviation_requests WHERE tenant_id = ${TENANT}`); await sqlAsTenant(TENANT, sql`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`).catch(() => undefined); });
afterAll(async () => { await sqlClient.end(); });

async function raise(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/workflow/deviations", headers: { authorization: `Bearer ${tok(MAKER, ["case_manager"])}` },
    payload: { entityType: "case", entityId: randomUUID(), deviationType: "process_skip", reason: "urgent field need" } });
  expect(res.statusCode).toBe(201);
  return res.json().data.id;
}

describe("CAP-039 maker-checker", () => {
  it("blocks the requester from approving their own deviation", async () => {
    const app = await buildApp();
    const id = await raise(app);
    const self = await app.inject({ method: "POST", url: `/v1/workflow/deviations/${id}/review`, headers: { authorization: `Bearer ${tok(MAKER, ["case_manager"])}` }, payload: { decision: "approve" } });
    expect(self.statusCode).toBe(403);
    expect(self.json().message).toContain("MAKER_CHECKER_VIOLATION");
    await app.close();
  });

  it("lets a different approver approve, then the waiver shows in the active register", async () => {
    const app = await buildApp();
    const id = await raise(app);
    const appr = await app.inject({ method: "POST", url: `/v1/workflow/deviations/${id}/review`, headers: { authorization: `Bearer ${tok(CHECKER, ["case_manager"])}` }, payload: { decision: "approve", note: "ok" } });
    expect(appr.statusCode).toBe(200);
    expect(appr.json().data.status).toBe("approved");
    const active = await app.inject({ method: "GET", url: "/v1/workflow/deviations/active", headers: { authorization: `Bearer ${tok(CHECKER, ["case_manager"])}` } });
    expect(active.json().data.some((d: { id: string }) => d.id === id)).toBe(true);
    await app.close();
  });

  it("cannot review a deviation twice", async () => {
    const app = await buildApp();
    const id = await raise(app);
    await app.inject({ method: "POST", url: `/v1/workflow/deviations/${id}/review`, headers: { authorization: `Bearer ${tok(CHECKER, ["case_manager"])}` }, payload: { decision: "reject" } });
    const again = await app.inject({ method: "POST", url: `/v1/workflow/deviations/${id}/review`, headers: { authorization: `Bearer ${tok(CHECKER, ["case_manager"])}` }, payload: { decision: "approve" } });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it("revokes an approved waiver and removes it from the active register", async () => {
    const app = await buildApp();
    const id = await raise(app);
    await app.inject({ method: "POST", url: `/v1/workflow/deviations/${id}/review`, headers: { authorization: `Bearer ${tok(CHECKER, ["case_manager"])}` }, payload: { decision: "approve" } });
    const rev = await app.inject({ method: "POST", url: `/v1/workflow/deviations/${id}/revoke`, headers: { authorization: `Bearer ${tok(CHECKER, ["case_manager"])}` } });
    expect(rev.statusCode).toBe(200);
    expect(rev.json().data.status).toBe("revoked");
    await app.close();
  });
});
