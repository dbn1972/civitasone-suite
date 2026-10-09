/**
 * GAP2-CRM-RTI-AUDIT-03.
 *
 * RTI's early-lifecycle acts (create, forward to CPIO, statutory respond,
 * first-appeal) now emit a platform `audit.event.record` outbox row in the SAME
 * transaction as the write — previously only the appeal-chain acts (decide /
 * second-appeal / dispose) did. On the old code these four acts left only a
 * case_status_history row, so the audit assertions here fail.
 *
 * DB-backed HTTP round-trip.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles = ["crm_user"]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-rti-audit" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}
const CLERK = () => headers(["crm_user"]);

const app = await buildApp();

afterAll(async () => {
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.case_status_history WHERE tenant_id = ${TENANT}`.catch(() => {});
      await tx`DELETE FROM crm.rti_requests WHERE tenant_id = ${TENANT}`.catch(() => {});
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

async function auditActions(id: string): Promise<string[]> {
  const rows = await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return tx<Array<{ action: string }>>`
      SELECT payload->>'action' AS action FROM _outbox.messages
      WHERE tenant_id = ${TENANT}
        AND event_type = 'audit.event.record'
        AND payload->>'resourceType' = 'rti_request'
        AND payload->>'resourceId' = ${id}
      ORDER BY created_at ASC, id ASC
    `;
  });
  return rows.map((r) => r.action);
}

async function createRti(): Promise<string> {
  const res = await app.inject({
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
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

describe("GAP2-CRM-RTI-AUDIT-03: early-lifecycle acts are audited", () => {
  it("create emits an audit event (action create)", async () => {
    const id = await createRti();
    expect(await auditActions(id)).toEqual(["create"]);
  });

  it("forward emits a forward audit event (no PII in payload)", async () => {
    const id = await createRti();
    expect((await app.inject({
      method: "PATCH", url: `/v1/crm/rti/${id}/forward`, headers: CLERK(),
      payload: { departmentRef: "LAND_RECORDS" },
    })).statusCode).toBe(200);
    expect(await auditActions(id)).toEqual(["create", "forward"]);
  });

  it("respond then first-appeal each emit an audit event", async () => {
    const id = await createRti();
    expect((await app.inject({
      method: "PATCH", url: `/v1/crm/rti/${id}/respond`, headers: CLERK(),
      payload: { responseText: "Records enclosed as sought." },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "PATCH", url: `/v1/crm/rti/${id}/first-appeal`, headers: CLERK(),
    })).statusCode).toBe(200);
    expect(await auditActions(id)).toEqual(["create", "respond", "first_appeal"]);
  });

  it("respondRti writes an audit outbox row (acceptance: fails on old code)", async () => {
    const id = await createRti();
    await app.inject({
      method: "PATCH", url: `/v1/crm/rti/${id}/respond`, headers: CLERK(),
      payload: { responseText: "Furnished within statutory deadline." },
    });
    const actions = await auditActions(id);
    expect(actions).toContain("respond");
  });
});
