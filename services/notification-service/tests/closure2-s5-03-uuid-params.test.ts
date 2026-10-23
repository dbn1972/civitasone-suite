/**
 * CLOS2-S5-03: dlt_templates.id, inbound_review_queue.id and
 * message_attachments.id are uuid columns. A malformed :id used to reach
 * Postgres (22P02) and come back as a retryable 500; it must now be a 400.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = "aaaaaaaa-1111-4000-8000-000000050003";
const ACTOR = "cccccccc-3333-4000-8000-000000050003";
const GOOD = "eeeeeeee-5555-4000-8000-0000000500ff";
const BAD = "abc";
const headers = (roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
  "x-tenant-id": TENANT,
});

afterAll(async () => { await sqlClient.end(); });

const N = "/notifications";
const cases: Array<[string, string, string, object?]> = [
  ["tenant_admin", "GET", `${N}/dlt-templates/:id`],
  ["tenant_admin", "PATCH", `${N}/dlt-templates/:id`, { status: "revoked" }],
  ["tenant_admin", "DELETE", `${N}/dlt-templates/:id`],
  ["notification_admin", "POST", `${N}/inbox/review-queue/:id/link`, { contactId: GOOD }],
  ["notification_admin", "POST", `${N}/inbox/review-queue/:id/resolve`, { action: "discard" }],
  ["notification_admin", "POST", `${N}/inbox/review-queue/:id/discard`, {}],
  ["notification_admin", "POST", `${N}/contact-review-queue/:id/resolve`, { contactId: GOOD }],
  ["notification_admin", "POST", `${N}/contact-review-queue/:id/discard`, {}],
  ["notification_admin", "GET", `${N}/attachments/:id`],
  ["notification_admin", "GET", `${N}/attachments/:id/download`],
];

describe("CLOS2-S5-03: :id must be a uuid", () => {
  it.each(cases)("%s %s %s with a malformed id is 400", async (role, method, tpl, payload) => {
    const app = await buildApp();
    const res = await app.inject({
      method: method as "GET", url: tpl.replace(":id", BAD), headers: headers([role]),
      ...(payload ? { payload } : {}),
    });
    await app.close();
    expect(res.statusCode, res.body).toBe(400);
  });

  it("a well-formed but unknown uuid still 404s", async () => {
    const app = await buildApp();
    const a = await app.inject({ method: "GET", url: `${N}/dlt-templates/${GOOD}`, headers: headers(["tenant_admin"]) });
    const b = await app.inject({ method: "POST", url: `${N}/inbox/review-queue/${GOOD}/discard`, headers: headers(["notification_admin"]), payload: {} });
    const c = await app.inject({ method: "GET", url: `${N}/attachments/${GOOD}`, headers: headers(["notification_admin"]) });
    await app.close();
    expect([a.statusCode, b.statusCode, c.statusCode]).toEqual([404, 404, 404]);
  });
});
