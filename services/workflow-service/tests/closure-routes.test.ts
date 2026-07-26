/** CAP-040 — closure/reopen/archival lifecycle over HTTP + DB. */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c1050000-0000-4000-8000-000000000040";
const tok = (roles = ["case_manager"]) => signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "s" }, SECRET);

afterEach(async () => { await sqlAsTenant(TENANT, sql`DELETE FROM workflow.entity_closures WHERE tenant_id = ${TENANT}`); await sqlAsTenant(TENANT, sql`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`).catch(() => undefined); });
afterAll(async () => { await sqlClient.end(); });

describe("CAP-040 lifecycle", () => {
  it("open -> close -> reopen (count increments) -> close -> archive; archive is terminal", async () => {
    const app = await buildApp();
    const body = { entityType: "case", entityId: randomUUID() };
    const h = { authorization: `Bearer ${tok()}` };

    const close1 = await app.inject({ method: "POST", url: "/v1/workflow/closure/close", headers: h, payload: { ...body, reason: "resolved" } });
    expect(close1.statusCode).toBe(200);
    expect(close1.json().data.status).toBe("closed");

    const reopen = await app.inject({ method: "POST", url: "/v1/workflow/closure/reopen", headers: h, payload: { ...body, reason: "new evidence" } });
    expect(reopen.json().data.status).toBe("reopened");
    expect(reopen.json().data.reopenCount).toBe(1);

    // cannot archive while reopened (must be closed)
    const badArchive = await app.inject({ method: "POST", url: "/v1/workflow/closure/archive", headers: h, payload: body });
    expect(badArchive.statusCode).toBe(409);

    await app.inject({ method: "POST", url: "/v1/workflow/closure/close", headers: h, payload: { ...body, reason: "re-resolved" } });
    const archive = await app.inject({ method: "POST", url: "/v1/workflow/closure/archive", headers: h, payload: body });
    expect(archive.json().data.status).toBe("archived");

    // terminal: cannot reopen an archived entity
    const reopenArchived = await app.inject({ method: "POST", url: "/v1/workflow/closure/reopen", headers: h, payload: { ...body, reason: "no" } });
    expect(reopenArchived.statusCode).toBe(409);
    await app.close();
  });

  it("rejects close without a reason", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/workflow/closure/close", headers: { authorization: `Bearer ${tok()}` }, payload: { entityType: "case", entityId: randomUUID(), reason: "" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
