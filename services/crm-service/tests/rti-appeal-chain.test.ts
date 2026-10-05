/**
 * GAP-CRM-RTI-DETAIL-01 — the RTI appeal chain no longer dead-ends at
 * FIRST_APPEAL. Real DB round trips through the HTTP routes:
 *
 *   RESPONDED -> first-appeal -> first-appeal/decide -> dispose
 *   RESPONDED -> first-appeal -> second-appeal -> dispose
 *
 * These FAIL on the old code: /first-appeal/decide, /second-appeal and
 * /dispose did not exist (404 from the router), so nothing could move an RTI
 * out of FIRST_APPEAL.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

function headers(roles: string[], tid = TENANT): Record<string, string> {
  const jwt = signToken({ sub: randomUUID(), tid, roles, sid: "sess-rti-appeal" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}
const ADMIN = () => headers(["crm_admin"]);
const CLERK = () => headers(["crm_user"]);

const ORDER = "The appeal is allowed. The CPIO shall furnish the records within 15 days.";
const REASON = "Information furnished as directed by the appellate order; closed.";

const app = await buildApp();

afterAll(async () => {
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.rti_requests WHERE tenant_id = ${TENANT}`;
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

async function patch(id: string, action: string, h: Record<string, string>, payload?: unknown) {
  return app.inject({
    method: "PATCH",
    url: `/v1/crm/rti/${id}/${action}`,
    headers: h,
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function detail(id: string) {
  const res = await app.inject({ method: "GET", url: `/v1/crm/rti/${id}`, headers: CLERK() });
  expect(res.statusCode).toBe(200);
  return res.json().data as Record<string, unknown>;
}

/** Create an RTI and walk it to FIRST_APPEAL. */
async function inFirstAppeal(): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/v1/crm/rti",
    headers: CLERK(),
    payload: {
      section: "s.6",
      departmentRef: "REVENUE",
      applicantName: "Appeal Applicant",
      subject: "Mutation register extracts",
      description: "Copies of mutation entries for survey no. 42.",
    },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().data.id as string;
  expect((await patch(id, "respond", CLERK(), { responseText: "Partial records enclosed." })).statusCode).toBe(200);
  expect((await patch(id, "first-appeal", CLERK())).statusCode).toBe(200);
  expect((await detail(id)).status).toBe("FIRST_APPEAL");
  return id;
}

async function auditCount(id: string): Promise<number> {
  const rows = await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return tx<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
        AND payload->>'resourceId' = ${id}
    `;
  });
  return rows[0]?.n ?? 0;
}

describe("GAP-CRM-RTI-DETAIL-01: first-appeal decision -> disposal", () => {
  it("records the FAA order, then disposes, with an audit event per step", async () => {
    const id = await inFirstAppeal();

    const decided = await patch(id, "first-appeal/decide", ADMIN(), { outcome: "allowed", orderText: ORDER });
    expect(decided.statusCode).toBe(200);
    let r = await detail(id);
    expect(r.status).toBe("FIRST_APPEAL");
    expect(r.firstAppealOutcome).toBe("allowed");
    expect(r.firstAppealOrder).toBe(ORDER);
    expect(r.firstAppealDecidedAt).toBeTruthy();

    // An order is recorded once only.
    const again = await patch(id, "first-appeal/decide", ADMIN(), { outcome: "dismissed", orderText: ORDER });
    expect(again.statusCode).toBe(422);
    expect(again.json().code).toBe("INVALID_STATE");

    const disposed = await patch(id, "dispose", ADMIN(), { reason: REASON });
    expect(disposed.statusCode).toBe(200);
    r = await detail(id);
    expect(r.status).toBe("DISPOSED");
    expect(r.disposalReason).toBe(REASON);
    expect(r.disposedAt).toBeTruthy();

    expect(await auditCount(id)).toBe(2);

    // Terminal: nothing moves a disposed request.
    expect((await patch(id, "second-appeal", CLERK(), { reference: "SIC/2026/001" })).statusCode).toBe(422);
    expect((await patch(id, "dispose", ADMIN(), { reason: REASON })).statusCode).toBe(422);
  });

  it("refuses to dispose an undecided first appeal", async () => {
    const id = await inFirstAppeal();
    const res = await patch(id, "dispose", ADMIN(), { reason: REASON });
    expect(res.statusCode).toBe(422);
    expect((await detail(id)).status).toBe("FIRST_APPEAL");
    expect(await auditCount(id)).toBe(0);
  });

  it("only an appellate (admin) role may decide or dispose; a crm_user gets 403", async () => {
    const id = await inFirstAppeal();
    expect((await patch(id, "first-appeal/decide", CLERK(), { outcome: "allowed", orderText: ORDER })).statusCode).toBe(403);
    expect((await detail(id)).firstAppealDecidedAt).toBeNull();
  });

  it("rejects a non-substantive order text and an unknown outcome with 400", async () => {
    const id = await inFirstAppeal();
    expect((await patch(id, "first-appeal/decide", ADMIN(), { outcome: "allowed", orderText: "ok" })).statusCode).toBe(400);
    expect((await patch(id, "first-appeal/decide", ADMIN(), { outcome: "granted", orderText: ORDER })).statusCode).toBe(400);
  });

  it("returns 404 for an unknown id and for another tenant's request", async () => {
    expect((await patch(randomUUID(), "first-appeal/decide", ADMIN(), { outcome: "allowed", orderText: ORDER })).statusCode).toBe(404);
    const id = await inFirstAppeal();
    const other = headers(["crm_admin"], randomUUID());
    expect((await patch(id, "first-appeal/decide", other, { outcome: "allowed", orderText: ORDER })).statusCode).toBe(404);
  });
});

describe("GAP-CRM-RTI-DETAIL-01: second appeal -> disposal", () => {
  it("records a second appeal (even before an FAA order) and then disposes", async () => {
    const id = await inFirstAppeal();

    const second = await patch(id, "second-appeal", CLERK(), { reference: "SIC/2026/0457" });
    expect(second.statusCode).toBe(200);
    let r = await detail(id);
    expect(r.status).toBe("SECOND_APPEAL");
    expect(r.secondAppealRef).toBe("SIC/2026/0457");
    expect(r.secondAppealAt).toBeTruthy();

    // No FAA decision once the matter is with the Commission.
    expect((await patch(id, "first-appeal/decide", ADMIN(), { outcome: "allowed", orderText: ORDER })).statusCode).toBe(422);

    expect((await patch(id, "dispose", ADMIN(), { reason: REASON })).statusCode).toBe(200);
    r = await detail(id);
    expect(r.status).toBe("DISPOSED");
    expect(await auditCount(id)).toBe(2);
  });
});
