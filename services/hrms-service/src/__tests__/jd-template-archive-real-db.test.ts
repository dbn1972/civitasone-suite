/**
 * GAP-HR-JD-TEMPLATES-04 -- the archive contract the JD template library UI
 * relies on.
 *
 * DELETE /v1/hrms/jd-templates/:id only QUEUES the archive command (the
 * consumer flags the row later), so it must answer 202 "accepted" rather than
 * a 200 that claims the template is already "archived". Until the consumer has
 * run the template is still listed; once it has, the list drops it but
 * GET /:id still returns it with isArchived=true -- which is exactly what the
 * library's pending-archive poll waits for before it refreshes the list.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET must be set by the vitest config");

const TENANT   = "a9a60000-0000-4000-8000-000000000001";
const ACTOR    = "a9a60000-0000-4000-8000-0000000000a0";
const LIVE_ID  = "a9a60000-0000-4000-8000-0000000000b1";
const GONE_ID  = "a9a60000-0000-4000-8000-0000000000b2";

const hrToken = signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s-jd" }, SECRET);
let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM recruitment.hrms_jd_templates WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`
    INSERT INTO recruitment.hrms_jd_templates (id, tenant_id, name, vacancy_type, is_archived, created_by, updated_by)
    VALUES (${LIVE_ID}, ${TENANT}, 'Live template', 'regular', false, ${ACTOR}, ${ACTOR}),
           (${GONE_ID}, ${TENANT}, 'Archived template', 'regular', true, ${ACTOR}, ${ACTOR})
  `);
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app?.close();
  await sqlClient.end();
});

const auth = { authorization: `Bearer ${hrToken}` };

describe("JD template archive -- GAP-HR-JD-TEMPLATES-04", () => {
  it("DELETE answers 202 'accepted' (queued), not a 200 that claims it is already archived", async () => {
    const r = await app.inject({ method: "DELETE", url: `/v1/hrms/jd-templates/${LIVE_ID}`, headers: auth });
    expect(r.statusCode).toBe(202);
    const body = JSON.parse(r.body) as { id: string; status: string };
    expect(body.id).toBe(LIVE_ID);
    expect(body.status).toBe("accepted");
  });

  it("the queued command has not changed the row yet, so the template is still listed until the consumer runs", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/jd-templates", headers: auth });
    const ids = (JSON.parse(r.body) as { data: Array<{ id: string }> }).data.map((t) => t.id);
    expect(ids).toContain(LIVE_ID);
  });

  it("an archived template drops out of the list but GET /:id still reports isArchived=true (what the UI polls for)", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/hrms/jd-templates", headers: auth });
    const ids = (JSON.parse(list.body) as { data: Array<{ id: string }> }).data.map((t) => t.id);
    expect(ids).not.toContain(GONE_ID);

    const one = await app.inject({ method: "GET", url: `/v1/hrms/jd-templates/${GONE_ID}`, headers: auth });
    expect(one.statusCode).toBe(200);
    expect((JSON.parse(one.body) as { isArchived: boolean }).isArchived).toBe(true);
    const live = await app.inject({ method: "GET", url: `/v1/hrms/jd-templates/${LIVE_ID}`, headers: auth });
    expect((JSON.parse(live.body) as { isArchived: boolean }).isArchived).toBe(false);
  });
});
