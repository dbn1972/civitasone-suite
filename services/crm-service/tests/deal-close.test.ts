/**
 * Deal close tests (OP-006).
 * Tests POST /v1/crm/deals/:id/close — won/lost, missing reason, validation —
 * and the close consumer that applies the stage/status/outcome writes.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS } from "../src/topics.js";
import { captureHandlers, drainQueue, envelope } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000040";
const ACTOR = "cccccccc-3333-4000-8000-000000000040";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-close" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${token(roles)}`,
    "x-tenant-id": TENANT,
  };
}

const OPEN_DEAL_ID = "55555555-eeee-4000-8000-000000000001";
const WON_DEAL_ID = "55555555-eeee-4000-8000-000000000002";
const LOST_DEAL_ID = "55555555-eeee-4000-8000-000000000003";
const PROPOSAL_DEAL_ID = "55555555-eeee-4000-8000-000000000004";
const NONEXIST_ID = "ffffffff-ffff-4000-8000-000000000099";
/** Deals used only by the consumer tests, so the route-level cases above cannot
 * change the rows they assert on. */
const APPLY_WON_DEAL_ID = "55555555-eeee-4000-8000-000000000011";
const APPLY_LOST_DEAL_ID = "55555555-eeee-4000-8000-000000000012";
const REDELIVERED_DEAL_ID = "55555555-eeee-4000-8000-000000000013";

async function seedDeals(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.deals (id, tenant_id, name, stage, value_minor, currency, status, version, created_at, updated_at, created_by, updated_by)
      VALUES
        (${OPEN_DEAL_ID}, ${TENANT}, 'Open Deal', 'Negotiation', 100000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${WON_DEAL_ID}, ${TENANT}, 'Won Deal', 'Won', 200000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${LOST_DEAL_ID}, ${TENANT}, 'Lost Deal', 'Lost', 50000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${PROPOSAL_DEAL_ID}, ${TENANT}, 'Proposal Deal', 'Proposal', 75000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${APPLY_WON_DEAL_ID}, ${TENANT}, 'Apply Won Deal', 'Negotiation', 300000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${APPLY_LOST_DEAL_ID}, ${TENANT}, 'Apply Lost Deal', 'Negotiation', 400000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${REDELIVERED_DEAL_ID}, ${TENANT}, 'Redelivered Deal', 'Proposal', 500000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

function scoped<T>(fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

function cmd(payload: unknown, messageId?: string) {
  return envelope(COMMANDS.closeDeal, payload, {
    tenantId: TENANT,
    actorId: ACTOR,
    ...(messageId !== undefined ? { messageId } : {}),
  });
}

/**
 * Return a deal to an open state so the next route-level case can close it.
 *
 * Drains first: the preceding case only got a 202, so its close is still in
 * flight on the bus. Without the drain the consumer's write can land *after*
 * this reset and put the deal back to Won, and the next request then fails
 * ALREADY_CLOSED. Status and the close columns are reset too — the consumer
 * writes all of them, so resetting stage alone leaves the row half-closed.
 */
async function reopenDeal(id: string): Promise<void> {
  await drainQueue();
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      UPDATE crm.deals
      SET stage = 'Negotiation', status = 'active', probability = 0,
          closed_at = NULL, close_reason = NULL, closed_value_minor = NULL,
          close_outcome = NULL, close_competitor = NULL
      WHERE id = ${id} AND tenant_id = ${TENANT}
    `;
  });
}

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

beforeAll(async () => {
  await cleanup();
  await seedDeals();
  registerAllConsumers(queue);
  await queue.start();
});

describe("POST /v1/crm/deals/:id/close", () => {
  describe("happy path — won", () => {
    it("closes deal as won → 202", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "won", reason: "" },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe("accepted");
    });

    it("closes deal as won with closedValue → 202", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${PROPOSAL_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "won", closedValue: "150000" },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("won does not require reason", async () => {
      await reopenDeal(OPEN_DEAL_ID);
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "won" },
      });
      await app.close();
      expect(res.statusCode).toBe(202);
    });
  });

  describe("happy path — lost", () => {
    it("closes deal as lost with valid reason → 202", async () => {
      await reopenDeal(OPEN_DEAL_ID);
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "lost", reason: "Budget was cut by the client organization" },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
    });
  });

  describe("missing/short reason for lost (400)", () => {
    it("rejects lost without reason → 400", async () => {
      await reopenDeal(OPEN_DEAL_ID);
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "lost", reason: "" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("REASON_REQUIRED");
    });

    it("rejects lost with short reason (< 10 chars) → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "lost", reason: "budget" },
      });
      await app.close();
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("REASON_REQUIRED");
    });

    it("rejects lost with whitespace-only reason → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "lost", reason: "          " },
      });
      await app.close();
      expect(res.statusCode).toBe(400);
    });
  });

  describe("already closed (422)", () => {
    it("rejects closing an already won deal → 422", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${WON_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "lost", reason: "Trying to close again for some reason" },
      });
      await app.close();
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("ALREADY_CLOSED");
    });

    it("rejects closing an already lost deal → 422", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${LOST_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "won" },
      });
      await app.close();
      expect(res.statusCode).toBe(422);
    });
  });

  describe("not found (404)", () => {
    it("returns 404 for non-existent deal", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${NONEXIST_ID}/close`,
        headers: headers(),
        payload: { outcome: "won" },
      });
      await app.close();
      expect(res.statusCode).toBe(404);
    });
  });

  describe("validation (400)", () => {
    it("rejects invalid outcome → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "draw" },
      });
      await app.close();
      expect(res.statusCode).toBe(400);
    });

    it("rejects invalid UUID in path → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/not-a-uuid/close`,
        headers: headers(),
        payload: { outcome: "won" },
      });
      await app.close();
      expect(res.statusCode).toBe(400);
    });
  });

  describe("auth", () => {
    it("returns 401 without token", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        payload: { outcome: "won" },
      });
      await app.close();
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: { authorization: `Bearer ${token(["citizen"])}`, "x-tenant-id": TENANT },
        payload: { outcome: "won" },
      });
      await app.close();
      expect(res.statusCode).toBe(403);
    });
  });
});

/**
 * Until the close consumer was registered, every 202 above left the deal open:
 * stage, status, closed_at and the mandatory loss reason were all discarded.
 */
describe("crm.deal.close consumer applies the close", () => {
  it("closes a deal as won — stage, status, probability, closed_at, realised value", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/deals/${APPLY_WON_DEAL_ID}/close`,
      headers: headers(),
      payload: { outcome: "won", closedValue: "275000" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);

    await drainQueue();

    const rows = await scoped((tx) => tx<Array<{
      stage: string; status: string; probability: number; closedAt: Date | null;
      closeReason: string | null; closedValueMinor: string | null; valueMinor: string; version: number;
    }>>`
      SELECT stage, status, probability, closed_at AS "closedAt", close_reason AS "closeReason",
             closed_value_minor AS "closedValueMinor", value_minor AS "valueMinor", version
      FROM crm.deals WHERE id = ${APPLY_WON_DEAL_ID} AND tenant_id = ${TENANT}
    `);
    const deal = rows[0]!;
    expect(deal.stage).toBe("Won");
    expect(deal.status).toBe("won");
    expect(deal.probability).toBe(100);
    expect(deal.closedAt).not.toBeNull();
    expect(String(deal.closedValueMinor)).toBe("275000");
    // The forecast value the deal carried while open is preserved.
    expect(String(deal.valueMinor)).toBe("300000");
    expect(deal.version).toBe(2);
  });

  it("closes a deal as lost and persists the mandatory reason", async () => {
    const reason = "Client cancelled the procurement after budget revision";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/deals/${APPLY_LOST_DEAL_ID}/close`,
      headers: headers(),
      payload: { outcome: "lost", reason },
    });
    await app.close();
    expect(res.statusCode).toBe(202);

    await drainQueue();

    const rows = await scoped((tx) => tx<Array<{
      stage: string; status: string; probability: number;
      closeReason: string | null; closedValueMinor: string | null;
    }>>`
      SELECT stage, status, probability, close_reason AS "closeReason",
             closed_value_minor AS "closedValueMinor"
      FROM crm.deals WHERE id = ${APPLY_LOST_DEAL_ID} AND tenant_id = ${TENANT}
    `);
    const deal = rows[0]!;
    expect(deal.stage).toBe("Lost");
    expect(deal.status).toBe("lost");
    expect(deal.probability).toBe(0);
    expect(deal.closeReason).toBe(reason);
    // No closedValue supplied — the deal value stands in as the realised amount.
    expect(String(deal.closedValueMinor)).toBe("400000");
  });

  it("emits crm.deal.closed and its audit event through the outbox", async () => {
    const events = await scoped((tx) => tx<Array<{ eventType: string }>>`
      SELECT event_type AS "eventType" FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type IN ('crm.deal.closed', 'audit.event.record')
    `);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("crm.deal.closed");
    expect(types).toContain("audit.event.record");
  });

  it("does not overwrite the first outcome when the close is redelivered or raced", async () => {
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(COMMANDS.closeDeal);

    const first = cmd({
      dealId: REDELIVERED_DEAL_ID, outcome: "won", reason: "", closedValue: "500000",
    });
    await runWithTenant(TENANT, () => handler(first));
    // Same messageId again (redelivery) and a different command racing a second
    // close — neither may flip a closed deal.
    await runWithTenant(TENANT, () => handler(first));
    await runWithTenant(TENANT, () => handler(cmd({
      dealId: REDELIVERED_DEAL_ID,
      outcome: "lost",
      reason: "Late loss report that must not win",
      closedValue: null,
    })));

    const rows = await scoped((tx) => tx<Array<{ stage: string; status: string; version: number }>>`
      SELECT stage, status, version FROM crm.deals
      WHERE id = ${REDELIVERED_DEAL_ID} AND tenant_id = ${TENANT}
    `);
    expect(rows[0]!.stage).toBe("Won");
    expect(rows[0]!.status).toBe("won");
    expect(rows[0]!.version).toBe(2);
  });
});
