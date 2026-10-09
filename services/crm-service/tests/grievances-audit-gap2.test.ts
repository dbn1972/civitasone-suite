/**
 * GAP2-CRM-GRIEVANCES-AUDIT-01 / -SCHEMA-04 / -ESCALATE-05.
 *
 * - AUDIT-01: every grievance lifecycle mutation (create/assign/forward/resolve/
 *   close/first-appeal) now writes an `audit.event.record` outbox row in the SAME
 *   transaction as the write. On the old code NO such row existed, so the audit
 *   assertions here fail.
 * - SCHEMA-04: an INSERT that omits `status` must succeed (DEFAULT now
 *   'REGISTERED', aligned with the CPGRAMS CHECK). On the old DEFAULT ('open')
 *   it violated grievances_status_cpgrams_check.
 * - ESCALATE-05: /escalate and /first-appeal produce identical rows, incl.
 *   appeal_reason, and both audit. On the old code /escalate ignored
 *   appeal_reason and emitted no audit.
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

function headers(roles = ["crm_admin"], tid = TENANT): Record<string, string> {
  const jwt = signToken({ sub: ACTOR, tid, roles, sid: "sess-grv-audit" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}
const ADMIN = () => headers(["crm_admin"]);
const CLERK = () => headers(["crm_user"]);

const app = await buildApp();

afterAll(async () => {
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.grievances WHERE tenant_id = ${TENANT}`.catch(() => {});
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

async function auditRows(id: string): Promise<Array<{ action: string; resourceType: string }>> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return tx<Array<{ action: string; resourceType: string }>>`
      SELECT payload->>'action' AS action, payload->>'resourceType' AS "resourceType"
      FROM _outbox.messages
      WHERE tenant_id = ${TENANT}
        AND event_type = 'audit.event.record'
        AND payload->>'resourceId' = ${id}
      ORDER BY created_at ASC, id ASC
    `;
  });
}

async function createGrievance(h = CLERK()): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/crm/grievances",
    headers: h,
    payload: {
      citizenName: "Ramesh Kumar",
      category: "Water Supply",
      subject: "No water for 3 days",
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

describe("GAP2-CRM-GRIEVANCES-AUDIT-01: lifecycle mutations emit audit", () => {
  it("create writes an audit.event.record outbox row (actor, tenant, action, resourceId)", async () => {
    const id = await createGrievance();
    const rows = await auditRows(id);
    expect(rows.length).toBe(1);
    expect(rows[0]!.action).toBe("register");
    expect(rows[0]!.resourceType).toBe("grievance");

    // The audit envelope carries actor + tenant + correlation.
    const [full] = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ actor_id: string; tenant_id: string }>>`
        SELECT actor_id, tenant_id FROM _outbox.messages
        WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
          AND payload->>'resourceId' = ${id} LIMIT 1
      `;
    });
    expect(full!.actor_id).toBe(ACTOR);
    expect(full!.tenant_id).toBe(TENANT);
  });

  it("forward then resolve each add an audit row (3 total incl. create)", async () => {
    const id = await createGrievance();
    expect((await app.inject({
      method: "PATCH", url: `/v1/crm/grievances/${id}/forward`, headers: CLERK(),
      payload: { forwardedTo: "Dept of Water Resources" },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "PATCH", url: `/v1/crm/grievances/${id}/resolve`, headers: CLERK(),
      payload: { resolution: "Pipe repaired" },
    })).statusCode).toBe(200);

    const rows = await auditRows(id);
    expect(rows.map((r) => r.action)).toEqual(["register", "forward", "resolve"]);
  });

  it("assign and close also audit", async () => {
    const id = await createGrievance();
    expect((await app.inject({
      method: "PATCH", url: `/v1/crm/grievances/${id}/assign`, headers: CLERK(),
      payload: { assignedTo: randomUUID() },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "PATCH", url: `/v1/crm/grievances/${id}/close`, headers: ADMIN(),
    })).statusCode).toBe(200);
    const rows = await auditRows(id);
    expect(rows.map((r) => r.action)).toEqual(["register", "assign", "close"]);
  });

  it("no audit row is written when the mutation affects no row (404 path)", async () => {
    const ghost = randomUUID();
    expect((await app.inject({
      method: "PATCH", url: `/v1/crm/grievances/${ghost}/resolve`, headers: CLERK(),
      payload: { resolution: "x" },
    })).statusCode).toBe(404);
    expect((await auditRows(ghost)).length).toBe(0);
  });
});

describe("GAP2-CRM-GRIEVANCES-ESCALATE-05: /escalate == /first-appeal", () => {
  it("both set APPEAL + urgent, record appeal_reason, and audit as first_appeal", async () => {
    const viaFirstAppeal = await createGrievance();
    const viaEscalate = await createGrievance();
    const reason = "Grievance unresolved after 30 days";

    const fa = await app.inject({
      method: "PATCH", url: `/v1/crm/grievances/${viaFirstAppeal}/first-appeal`,
      headers: CLERK(), payload: { appealReason: reason },
    });
    const es = await app.inject({
      method: "PATCH", url: `/v1/crm/grievances/${viaEscalate}/escalate`,
      headers: CLERK(), payload: { appealReason: reason },
    });
    expect(fa.statusCode).toBe(200);
    expect(es.statusCode).toBe(200);

    const faData = fa.json().data as Record<string, unknown>;
    const esData = es.json().data as Record<string, unknown>;
    expect(faData.status).toBe("APPEAL");
    expect(esData.status).toBe("APPEAL");
    expect(faData.priority).toBe("urgent");
    expect(esData.priority).toBe("urgent");
    // The old /escalate dropped appeal_reason; now it records it like first-appeal.
    expect(esData.appealReason).toBe(reason);
    expect(faData.appealReason).toBe(reason);

    expect((await auditRows(viaEscalate)).map((r) => r.action)).toEqual(["register", "first_appeal"]);
    expect((await auditRows(viaFirstAppeal)).map((r) => r.action)).toEqual(["register", "first_appeal"]);
  });
});

describe("GAP2-CRM-GRIEVANCES-SCHEMA-04: status default aligns with CPGRAMS CHECK", () => {
  it("an INSERT omitting status succeeds (lands on REGISTERED)", async () => {
    const [row] = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ status: string }>>`
        INSERT INTO crm.grievances
          (tenant_id, citizen_name, category, subject, reference_no, created_by, updated_by)
        VALUES
          (${TENANT}, 'Default Status', 'Roads', 'Pothole',
           ${"DARPG/2026/" + Math.floor(Math.random() * 900000 + 100000)},
           ${ACTOR}, ${ACTOR})
        RETURNING status
      `;
    });
    expect(row!.status).toBe("REGISTERED");
  });
});
