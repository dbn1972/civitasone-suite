/**
 * TX-018 (visitor-service slice) — visit-request restricted-area check
 * nested-transaction connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-018 sweep — the same
 * blind-spot class TX-011's nested-tx-guard.mjs was built to catch (and, on
 * its own first fleet-wide run, actually did catch this exact site):
 * visit-request/consumer.ts's visitRequestApprove handler — while inside its
 * own already-open db.transaction() (markProcessed(tx, ...) confirms tx is
 * live in scope) — called hasRestrictedArea() with no tx param, which
 * unconditionally opened its OWN nested db.transaction() to read the
 * permitted areas' security levels. Under pool.max concurrent in-flight
 * approval consumer transactions, every one of them needs an extra
 * ("nested") pool connection at the same moment none is free, deadlocking
 * the whole queue silently forever.
 *
 * This test exercises visitor.visit_request.approve on 13 independent visit
 * requests, all naming the SAME restricted area (security_level 2), at once
 * — pool.max (10) + 3 concurrency, real Postgres, real pool — a realistic
 * trigger (a host or security desk approving a batch of pending requests for
 * the same restricted wing around the same moment).
 *
 * Fixed by routing the handler's hasRestrictedArea(...) call onto
 * hasRestrictedAreaTx(tx, ...), which reads through the caller's
 * already-open tx instead of opening its own (visit-request/consumer.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerVisitRequestConsumers } from "../src/modules/visit-request/consumer.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { locations, areas } from "../src/modules/location/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "18000000-0000-4000-8000-000000000018";
const HOST = "18000000-0000-4000-8000-0000000000ba";
const LOCATION = "18000000-0000-4000-8000-000000000ca1";
const RESTRICTED_AREA = "18000000-0000-4000-8000-000000000aea";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly the test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;
const REQUEST_IDS = Array.from({ length: CONCURRENCY }, () => randomUUID());

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId: TENANT,
    actorId: HOST, correlationId: randomUUID(), schemaVersion: "1.0",
    payload,
  };
}

async function clean() {
  await withTenantScope(db, TENANT, (tx) =>
    tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)),
  );
  await withTenantScope(db, TENANT, (tx) =>
    tx.delete(visitRequests).where(eq(visitRequests.tenantId, TENANT)),
  );
  await withTenantScope(db, TENANT, (tx) =>
    tx.delete(areas).where(eq(areas.tenantId, TENANT)),
  );
  await withTenantScope(db, TENANT, (tx) =>
    tx.delete(locations).where(eq(locations.tenantId, TENANT)),
  );
}

beforeAll(async () => {
  await clean();
  await withTenantScope(db, TENANT, (tx) =>
    tx.insert(locations).values({
      id: LOCATION, tenantId: TENANT, name: "TX-018 fixture location",
      businessHours: {
        mon: { open: "09:00", close: "18:00" }, tue: { open: "09:00", close: "18:00" },
        wed: { open: "09:00", close: "18:00" }, thu: { open: "09:00", close: "18:00" },
        fri: { open: "09:00", close: "18:00" }, sat: null, sun: null,
      },
      createdBy: HOST, updatedBy: HOST,
    }),
  );
  await withTenantScope(db, TENANT, (tx) =>
    // security_level 2 > RESTRICTED_SECURITY_LEVEL (1) — a genuinely
    // restricted area, matching the vulnerable branch this gap describes.
    tx.insert(areas).values({
      id: RESTRICTED_AREA, tenantId: TENANT, locationId: LOCATION,
      name: "TX-018 fixture restricted wing", securityLevel: 2,
      authorizedApprovers: [HOST],
      createdBy: HOST, updatedBy: HOST,
    }),
  );
  await withTenantScope(db, TENANT, (tx) =>
    tx.insert(visitRequests).values(REQUEST_IDS.map((id, i) => ({
      id, tenantId: TENANT, locationId: LOCATION, hostEmployeeId: HOST,
      status: "pending_approval", permittedAreas: [RESTRICTED_AREA],
      visitorName: `TX-018 Visitor ${i}`, visitorPhone: `+9199900000${String(i).padStart(2, "0")}`,
      createdBy: HOST, updatedBy: HOST,
    }))),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("visit-request consumer visitRequestApprove — restricted-area nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent visitRequestApprove commands against the same restricted area drain without deadlocking the connection pool`,
    async () => {
      const q = new MemoryQueue();
      // registerVisitRequestConsumers() tenant-scopes the queue internally
      // (tenantScoped(rawQueue), shared/tenant-queue.ts) — no manual wrapping
      // needed here, unlike services whose registration does not self-wrap.
      registerVisitRequestConsumers(q);
      await q.start();

      await Promise.all(REQUEST_IDS.map((id) =>
        q.publish(COMMANDS.visitRequestApprove, makeMsg(COMMANDS.visitRequestApprove, {
          id, tenantId: TENANT,
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms — nested-transaction pool deadlock regressed`).toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // isn't masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify((q as MemoryQueue).dlq)}`).toHaveLength(0);

      // State assertion: a restricted area routes to workflow-service
      // instead of direct approval, so the request stays pending_approval
      // (proves hasRestrictedAreaTx's read actually ran and correctly saw
      // the area as restricted, not just that nothing crashed).
      const rows = await withTenantScope(db, TENANT, (tx) =>
        tx.select().from(visitRequests).where(inArray(visitRequests.id, REQUEST_IDS)),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        expect(row.status).toBe("pending_approval");
      }

      // One workflow.instance.create outbox message per request — proves the
      // restricted branch (the one gated behind hasRestrictedAreaTx's read)
      // ran to completion and committed, for every one of the 13 requests.
      const workflowMsgs = await withTenantScope(db, TENANT, (tx) =>
        tx.select().from(outboxMessages).where(
          and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, "workflow.instance.create")),
        ),
      );
      expect(workflowMsgs).toHaveLength(CONCURRENCY);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
