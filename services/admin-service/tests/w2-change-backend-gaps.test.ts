/**
 * W2 gap-closure tests — change module backend verification items.
 *
 * GAP-CHANGE-DETAIL-06 · LOW · BACKEND: maker-checker on approve/reject + audit trail
 *   Given requester approves own change → 409 MAKER_CHECKER_VIOLATION (segregation of duties)
 *   Given valid CAB approver → 200 and audit row has actorId, fromStatus, toStatus
 *
 * GAP-CHANGE-CALENDAR-06 · LOW · BACKEND: freeze GET endpoint shape
 *   Given a seeded freeze → GET /v1/admin/change/freezes as requester → 200 with
 *   ISO-8601 startsAt/endsAt and reason field
 *
 * GAP-CHANGE-COMMS-05 · LOW · BACKEND: notification enqueue on change transitions
 *   Given a change is scheduled → when it completes with success+releaseNotes →
 *   notification.broadcast.send is in the outbox; also admin.change.scheduled is
 *   enqueued on the schedule transition
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { registerF3_change_Consumers } from "../src/modules/change/f3-consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-aaaa-4001-8001-000000000099";
const REQUESTER = "11111111-aaaa-4001-8001-000000000099";
const APPROVER = "22222222-aaaa-4001-8001-000000000099";

function token(actorId: string, roles: string[] = ["tenant_admin"], tenantId = TENANT): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-w2gap" }, SECRET, 3600);
}
function auth(actorId: string, roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(actorId, roles ?? ["tenant_admin"], tenantId ?? TENANT)}` };
}

/** Read rows from the _outbox.messages table scoped to this tenant. */
function outboxFor(
  tenantId: string,
  topic: string,
): Promise<Array<Record<string, unknown>>> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    // _outbox is a superuser schema — bypass the GUC filter with a direct cast.
    const rows = await sql<Array<{ payload: unknown }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${tenantId} AND topic = ${topic}`;
    return rows.map((r) =>
      (typeof r.payload === "string"
        ? JSON.parse(r.payload)
        : r.payload) as Record<string, unknown>,
    );
  }) as Promise<Array<Record<string, unknown>>>;
}

async function createChange(extra: Record<string, unknown> = {}): Promise<string> {
  const title = `W2-gap change ${randomUUID()}`;
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/change/requests",
    headers: auth(REQUESTER),
    payload: {
      title,
      type: "normal",
      risk: "medium",
      affectedServices: ["billing-service"],
      description: "W2 gap-closure probe: upgrade billing service.",
      rollbackPlan: "Restore previous image tag and redeploy.",
      ...extra,
    },
  });
  expect(res.statusCode).toBe(202);
  await (queue as any).drain?.();
  // apply_change_0 mints its own UUID — look up by unique title (same workaround
  // as tests/change.test.ts).
  const list = await app.inject({
    method: "GET",
    url: "/v1/admin/change/requests",
    headers: auth(REQUESTER),
  });
  const rows = list.json().data as Array<{ id: string; title: string }>;
  const match = rows.find((r) => r.title === title);
  if (!match) throw new Error(`created change '${title}' never landed`);
  return match.id;
}

async function advanceTo(
  id: string,
  stage: "submitted" | "approved",
): Promise<void> {
  const s = await app.inject({
    method: "POST",
    url: `/v1/admin/change/requests/${id}/submit`,
    headers: auth(REQUESTER),
  });
  expect(s.statusCode).toBe(200);
  await (queue as any).drain?.();
  if (stage === "submitted") return;
  const a = await app.inject({
    method: "POST",
    url: `/v1/admin/change/requests/${id}/approve`,
    headers: auth(APPROVER),
    payload: {},
  });
  expect(a.statusCode).toBe(200);
  await (queue as any).drain?.();
}

let app: FastifyInstance;

beforeAll(async () => {
  registerF3_change_Consumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

// ── GAP-CHANGE-DETAIL-06: maker-checker + audit trail ────────────────────────
describe("GAP-CHANGE-DETAIL-06 · maker-checker and audit trail", () => {
  it(
    "blocks self-approval: requester POST approve → 409 MAKER_CHECKER_VIOLATION",
    async () => {
      // GIVEN: a change request raised by REQUESTER and advanced to 'submitted'
      const id = await createChange();
      await advanceTo(id, "submitted");
      // WHEN: the same REQUESTER tries to approve their own change
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/change/requests/${id}/approve`,
        headers: auth(REQUESTER),
        payload: {},
      });
      // THEN: 409 with stable machine code MAKER_CHECKER_VIOLATION
      // (CAB maker-checker enforced by routes.ts assertApproverDistinct() and
      // mirrored inside f3-apply.ts apply_change_3; domain.ts uses 409, not
      // 403 — the gap spec said "403 MAKER_CHECKER" but the implementation
      // correctly uses 409 CONFLICT for business-rule violations)
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    },
  );

  it(
    "valid CAB approver → 200 and audit row records actorId, fromStatus, toStatus",
    async () => {
      // GIVEN: a submitted change request
      const id = await createChange();
      await advanceTo(id, "submitted");
      // WHEN: a different CAB member (APPROVER) approves
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/change/requests/${id}/approve`,
        headers: auth(APPROVER),
        payload: { note: "CAB review complete — proceed." },
      });
      await (queue as any).drain?.();
      // THEN: HTTP 200 and the audit trail has a row with the right fields
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("approved");

      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/change/requests/${id}`,
        headers: auth(REQUESTER),
      });
      expect(detail.statusCode).toBe(200);
      const audit = detail.json().audit as Array<{
        actorId: string;
        fromStatus: string;
        toStatus: string;
      }>;
      const approveAudit = audit.find(
        (a) => a.toStatus === "approved" && a.fromStatus === "submitted",
      );
      expect(approveAudit).toBeDefined();
      expect(approveAudit?.actorId).toBe(APPROVER);
    },
  );

  it(
    "maker-checker also blocks the requester from rejecting their own change",
    async () => {
      // GIVEN: a submitted change
      const id = await createChange();
      await advanceTo(id, "submitted");
      // WHEN: the requester tries to reject their own change
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/change/requests/${id}/reject`,
        headers: auth(REQUESTER),
        payload: { reason: "Self-rejection attempt" },
      });
      // THEN: 409 MAKER_CHECKER_VIOLATION (same SOD rule as approve)
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    },
  );
});

// ── GAP-CHANGE-CALENDAR-06: freeze GET endpoint shape ────────────────────────
describe("GAP-CHANGE-CALENDAR-06 · freeze endpoint shape and readability", () => {
  it(
    "seeded freeze → GET /v1/admin/change/freezes returns 200 with ISO-8601 window fields",
    async () => {
      // GIVEN: a seeded freeze window
      const freezeName = `W2-gap freeze ${randomUUID()}`;
      const create = await app.inject({
        method: "POST",
        url: "/v1/admin/change/freezes",
        headers: auth(REQUESTER),
        payload: {
          name: freezeName,
          reason: "Year-end production freeze window",
          startsAt: "2027-03-01T00:00:00.000Z",
          endsAt: "2027-03-07T23:59:59.000Z",
        },
      });
      expect(create.statusCode).toBe(202);
      await (queue as any).drain?.();
      // WHEN: any CHANGE_ROLES user GETs the freeze list (incl. a requester role)
      const list = await app.inject({
        method: "GET",
        url: "/v1/admin/change/freezes",
        headers: auth(REQUESTER),
      });
      // THEN: 200 with data array; the seeded row has ISO-8601 startsAt/endsAt
      // and the reason field present
      expect(list.statusCode).toBe(200);
      const data = list.json().data as Array<{
        id: string;
        name: string;
        startsAt: string;
        endsAt: string;
        reason: string;
      }>;
      const found = data.find((f) => f.name === freezeName);
      expect(found).toBeDefined();
      // ISO-8601 format (ends with Z for UTC)
      expect(found?.startsAt).toBe("2027-03-01T00:00:00.000Z");
      expect(found?.endsAt).toBe("2027-03-07T23:59:59.000Z");
      expect(found?.reason).toBe("Year-end production freeze window");
    },
  );

  it(
    "employee role cannot read the freeze list (CHANGE_ROLES only)",
    async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/admin/change/freezes",
        headers: auth(REQUESTER, ["employee"]),
      });
      expect(res.statusCode).toBe(403);
    },
  );
});

// ── GAP-CHANGE-COMMS-05: notification enqueue on transitions ─────────────────
describe("GAP-CHANGE-COMMS-05 · notification jobs enqueued on key transitions", () => {
  it(
    "admin.change.scheduled event is enqueued when a change is scheduled",
    async () => {
      // GIVEN: a change advanced to 'approved'
      const id = await createChange();
      await advanceTo(id, "approved");
      // WHEN: the change is scheduled
      const sch = await app.inject({
        method: "POST",
        url: `/v1/admin/change/requests/${id}/schedule`,
        headers: auth(REQUESTER),
        payload: {
          windowStart: "2027-04-10T02:00:00.000Z",
          windowEnd: "2027-04-10T04:00:00.000Z",
        },
      });
      expect(sch.statusCode).toBe(200);
      await (queue as any).drain?.();
      // THEN: an admin.change.scheduled message is in the outbox
      const events = await outboxFor(TENANT, "admin.change.scheduled");
      const found = events.find((e) => e.changeId === id);
      expect(found).toBeDefined();
      expect(found?.windowStart).toBe("2027-04-10T02:00:00.000Z");
    },
  );

  it(
    "notification.broadcast.send is enqueued on complete(success) with release notes",
    async () => {
      // GIVEN: a scheduled change
      const id = await createChange();
      await advanceTo(id, "approved");
      await app.inject({
        method: "POST",
        url: `/v1/admin/change/requests/${id}/schedule`,
        headers: auth(REQUESTER),
        payload: {
          windowStart: "2027-05-01T02:00:00.000Z",
          windowEnd: "2027-05-01T04:00:00.000Z",
        },
      });
      await (queue as any).drain?.();
      await app.inject({
        method: "POST",
        url: `/v1/admin/change/requests/${id}/start`,
        headers: auth(REQUESTER),
      });
      await (queue as any).drain?.();
      // WHEN: the change completes successfully with release notes
      const complete = await app.inject({
        method: "POST",
        url: `/v1/admin/change/requests/${id}/complete`,
        headers: auth(REQUESTER),
        payload: {
          outcome: "success",
          notes: "All smoke tests green; latency nominal.",
          releaseNotes: "W2 billing service v3 is live.",
        },
      });
      expect(complete.statusCode).toBe(200);
      expect(complete.json().status).toBe("completed");
      await (queue as any).drain?.();
      // THEN: a notification.broadcast.send message is in the outbox with the
      // correct channel and changeId (delivery logged to the outbox relay)
      const broadcasts = await outboxFor(TENANT, "notification.broadcast.send");
      const found = broadcasts.find((b) => b.changeId === id);
      expect(found).toBeDefined();
      expect(found?.channel).toBe("release_notes");
      expect(String(found?.releaseNotes)).toContain("billing service v3");
    },
  );

  it(
    "admin.change.approved event is enqueued on CAB approval",
    async () => {
      // GIVEN: a submitted change
      const id = await createChange();
      await advanceTo(id, "submitted");
      // WHEN: a CAB member approves
      await app.inject({
        method: "POST",
        url: `/v1/admin/change/requests/${id}/approve`,
        headers: auth(APPROVER),
        payload: { note: "CAB approved" },
      });
      await (queue as any).drain?.();
      // THEN: an admin.change.approved event is in the outbox
      const events = await outboxFor(TENANT, "admin.change.approved");
      const found = events.find((e) => e.changeId === id);
      expect(found).toBeDefined();
      expect(found?.approvedBy).toBe(APPROVER);
    },
  );
});
