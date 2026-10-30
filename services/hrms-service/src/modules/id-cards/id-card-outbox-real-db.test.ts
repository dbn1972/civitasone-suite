/**
 * F72 (UAT W7) -- real-DB guard: id-card writes enqueue their side-effect
 * messages through the transactional outbox, in the SAME transaction as the
 * card write, and never touch the queue on the request path.
 *
 * Before the fix POST /v1/hrms/id-cards committed the card and then awaited
 * two direct queue.publish() calls; against a slow broker (UAT LocalStack at
 * ~3.6 s per SQS call) that held the request past the gateway's 15 s budget
 * (504 for a card that had been issued), and a publish failure after commit
 * either lost the audit command or 500'd for a card that existed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../../app.js";
import { sqlClient } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const HR_ADMIN = randomUUID();
const EMPLOYEE = randomUUID();

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const jwt = signToken({ sub: HR_ADMIN, tid: TENANT, roles: ["hr_admin"], sid: "sess-f72" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}`, ...extra };
}

type OutboxRow = { topic: string; event_type: string; payload: Record<string, unknown> };

async function outboxRowsFor(cardId: string): Promise<OutboxRow[]> {
  return withRawTenantGuc(sqlClient, TENANT, async (tx) => {
    const rows = await tx.unsafe(
      `SELECT topic, event_type, payload FROM _outbox.messages
        WHERE tenant_id = $1 AND (payload->>'id' = $2 OR payload->'variables'->>'cardNumber' IN
              (SELECT card_number FROM hrms.id_cards WHERE id = $2::uuid))
        ORDER BY created_at, topic`,
      [TENANT, cardId],
    );
    return rows as unknown as OutboxRow[];
  });
}

async function cardRows(where: string, params: unknown[]): Promise<Array<{ id: string; status: string }>> {
  return withRawTenantGuc(sqlClient, TENANT, async (tx) =>
    (await tx.unsafe(`SELECT id, status FROM hrms.id_cards WHERE tenant_id = $1 AND ${where}`, [TENANT, ...params] as never[])) as unknown as Array<{ id: string; status: string }>,
  );
}

/** Resolves to "timeout" if `p` has not settled within `ms`. */
function within<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);
}

let app: FastifyInstance;
// A broker that never answers: if any id-card route still awaited the bus,
// its request would hang here exactly like the UAT 504.
const publishSpy = vi.spyOn(queue, "publish").mockImplementation(() => new Promise<string>(() => undefined));

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  publishSpy.mockRestore();
  await app.close();
  await sqlClient.end();
});

const issueBody = (holderName: string) => ({
  holderName, cardType: "employee", validUntil: "2027-12-31", employeeId: EMPLOYEE,
});

describe("F72 -- id-card writes go through the outbox, not the bus", () => {
  it("issue: 201 promptly with a hung broker; card + audit command + notification committed together", async () => {
    publishSpy.mockClear();
    const res = await within(
      app.inject({ method: "POST", url: "/v1/hrms/id-cards", headers: headers(), payload: issueBody("F72 Holder One") }),
      5_000,
    );
    expect(res).not.toBe("timeout");
    if (res === "timeout") return;
    expect(res.statusCode).toBe(201);
    const { id, cardNumber } = res.json() as { id: string; cardNumber: string };
    expect(publishSpy).not.toHaveBeenCalled();

    expect(await cardRows("id = $2::uuid", [id])).toEqual([{ id, status: "active" }]);
    const rows = await outboxRowsFor(id);
    expect(rows.map((r) => r.topic).sort()).toEqual(["hrms.id_card.issue", "notification.send"]);
    const audit = rows.find((r) => r.topic === "hrms.id_card.issue")!;
    expect(audit.payload).toMatchObject({ id, tenantId: TENANT, employeeId: EMPLOYEE, cardType: "employee" });
    const notif = rows.find((r) => r.topic === "notification.send")!;
    expect(notif.event_type).toBe("hrms.id_card.issued");
    expect(notif.payload).toMatchObject({ recipientId: EMPLOYEE, variables: { cardNumber, holderName: "F72 Holder One" } });
  });

  it("issue: when the outbox write fails the card INSERT rolls back with it (no card, no outbox row)", async () => {
    // correlation_id is varchar(64) on _outbox.messages: an over-long
    // correlation id makes enqueue() -- which runs AFTER the card INSERT in
    // the same transaction -- fail, so the transaction must roll back.
    const holder = `F72 Rollback ${randomUUID()}`;
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/id-cards",
      headers: headers({ "x-correlation-id": "x".repeat(100) }),
      payload: issueBody(holder),
    });
    expect(res.statusCode).toBe(500);
    expect(await cardRows("holder_name = $2", [holder])).toEqual([]);
    const orphan = await withRawTenantGuc(sqlClient, TENANT, (tx) =>
      tx.unsafe(`SELECT 1 FROM _outbox.messages WHERE tenant_id = $1 AND payload->>'holderName' = $2`, [TENANT, holder]),
    );
    expect(orphan.length).toBe(0);
  });

  it("suspend + reactivate: 200 promptly with a hung broker; each status change commits its own audit command", async () => {
    const issued = await app.inject({ method: "POST", url: "/v1/hrms/id-cards", headers: headers(), payload: issueBody("F72 Holder Two") });
    expect(issued.statusCode).toBe(201);
    const { id } = issued.json() as { id: string };
    publishSpy.mockClear();

    const sus = await within(
      app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${id}/suspend`, headers: headers(), payload: { reason: "F72 lost" } }),
      5_000,
    );
    expect(sus).not.toBe("timeout");
    if (sus === "timeout") return;
    expect(sus.statusCode).toBe(200);

    const rea = await within(
      app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${id}/reactivate`, headers: headers(), payload: {} }),
      5_000,
    );
    expect(rea).not.toBe("timeout");
    if (rea === "timeout") return;
    expect(rea.statusCode).toBe(200);
    expect(publishSpy).not.toHaveBeenCalled();

    expect(await cardRows("id = $2::uuid", [id])).toEqual([{ id, status: "active" }]);
    const topics = (await outboxRowsFor(id)).map((r) => r.topic);
    expect(topics.filter((t) => t === "hrms.id_card.suspend")).toHaveLength(1);
    expect(topics.filter((t) => t === "hrms.id_card.reactivate")).toHaveLength(1);
  });

  it("a no-op status change (unknown / wrong-state card) writes no outbox row", async () => {
    const ghost = randomUUID();
    const res = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${ghost}/revoke`, headers: headers(), payload: {} });
    expect(res.statusCode).toBe(404);
    expect(await outboxRowsFor(ghost)).toEqual([]);
  });
});
