/**
 * masters/consumer.ts — finance.masters.pao_sync / finance.masters.ddo_sync
 * CRITICAL bug regression (real Postgres, no mocks).
 *
 * PROVEN BUG (finance-service functional sweep): both handlers marked the
 * message processed, published a "finance.masters.synced" notification, and
 * wrote an audit log entry claiming success -- but neither ever inserted or
 * updated a single row in payments.finance_pao / payments.finance_ddo.
 * GET /v1/finance/pao and /ddo (routes.ts -> repo.listPao/listDdo) stayed
 * `{"data":[]}` forever, no matter how many "successful" syncs ran.
 *
 * ROOT CAUSE: no INSERT/UPDATE anywhere in either handler (contrast
 * COMMANDS.bankAccountCreate a few lines down in consumer.ts, which does a
 * real tx.insert(bankAccounts)...). The payload was only ever cast as
 * `{ tenantId, source? }` -- never the actual master-record fields
 * (paoCode/name/ministry, ddoCode/name/paoCode) that
 * payments.finance_pao/finance_ddo require and that GET already reads back.
 *
 * NO REAL PRODUCER EXISTS ANYWHERE (verified against the whole repo, not
 * assumed): "finance.masters.pao_sync"/"ddo_sync" are not in topics.ts's
 * COMMANDS, have no HTTP route or other service publishing them, and are
 * listed in tests/contract/{allowlist,known-defects}.json as
 * "undeclaredDeadSubscriptions". The only two real call sites in the repo
 * were this consumer's own queue.subscribe() and this file's sibling
 * consumer-coverage-ext.test.ts, which only ever published
 * `{tenantId, source}`. That is why the fix below both (a) performs a real
 * upsert when the payload actually carries paoCode/name (ddoCode/name for
 * DDO) -- the only fields payments.finance_pao/finance_ddo need, already
 * established by migrations/0010_hoa_pao_voucher.sql's own seed insert and
 * by schema.ts/routes.ts -- and (b) fails loudly (DomainError, DLQ-visible)
 * instead of silently "succeeding" when those required fields are absent,
 * exactly like this file's COMMANDS.openingBalancesEnter handler already
 * does for an unbalanced entry set (see masters-opening-balance-race.test.ts
 * for that precedent). Wiring an actual upstream producer (a real PFMS/CGA
 * master-data feed, or an internal admin form) is a separate follow-up --
 * this fix only makes the CONSUMER correct and honest about what it did.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { registerMastersConsumers } from "../src/modules/masters/consumer.js";
import { financePao, financeDdo } from "../src/modules/masters/schema.js";
import * as repo from "../src/modules/masters/repo.js";

const TENANT = "70000000-0ba1-4000-8000-0000000000df";
const ACTOR = "70000000-0ba1-4000-8000-00000000a0df";
const PAO_CODE = "PAOZT01";
const DDO_CODE = "DDOZT0001";
const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const financeAdmin = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["finance_admin"], sid: "sess-pao-ddo-sync" }, JWT_SECRET)}`,
});

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(financePao).where(and(eq(financePao.tenantId, TENANT), eq(financePao.paoCode, PAO_CODE)));
      await tx.delete(financeDdo).where(and(eq(financeDdo.tenantId, TENANT), eq(financeDdo.ddoCode, DDO_CODE)));
    }),
  );
}

function makeMsg(topic: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: topic, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

/** Mirrors worker.ts's global subscribe wrap (see masters-opening-balance-race.test.ts):
 *  every handler runs under the message's tenant GUC so FORCE RLS reads/writes
 *  succeed, exactly like production. Without this, payments.finance_pao/finance_ddo's
 *  tenant_isolation_policy WITH CHECK fails on every insert. */
function tenantWrappedQueue(opts: { maxAttempts?: number } = {}): MemoryQueue {
  const q = new MemoryQueue(opts);
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("finance.masters.pao_sync / ddo_sync consumer (real DB, no mocks)", () => {
  it("a real, fully-specified pao_sync event creates a correctly-populated finance_pao row, readable via listPao (GET /v1/finance/pao)", async () => {
    const q = tenantWrappedQueue();
    registerMastersConsumers(q);
    await q.start();

    await q.publish("finance.masters.pao_sync", makeMsg("finance.masters.pao_sync", {
      tenantId: TENANT, paoCode: PAO_CODE, name: "Pay & Accounts Office (Zonal Test)",
      ministry: "Ministry of Test Affairs", source: "pfms",
    }));
    await q.drain();

    expect(q.dlq.length).toBe(0);
    const rows = await runWithTenant(TENANT, () => repo.listPao(TENANT));
    const row = rows.find((r) => r.paoCode === PAO_CODE);
    expect(row).toBeDefined();
    expect(row!.name).toBe("Pay & Accounts Office (Zonal Test)");
    expect(row!.ministry).toBe("Ministry of Test Affairs");
    expect(row!.isActive).toBe(true);
    await q.stop();
  });

  it("a real, fully-specified ddo_sync event creates a correctly-populated finance_ddo row, readable via listDdo (GET /v1/finance/ddo)", async () => {
    const q = tenantWrappedQueue();
    registerMastersConsumers(q);
    await q.start();

    await q.publish("finance.masters.ddo_sync", makeMsg("finance.masters.ddo_sync", {
      tenantId: TENANT, ddoCode: DDO_CODE, name: "Drawing & Disbursing Officer (Zonal Test)",
      paoCode: PAO_CODE, source: "pfms",
    }));
    await q.drain();

    expect(q.dlq.length).toBe(0);
    const rows = await runWithTenant(TENANT, () => repo.listDdo(TENANT));
    const row = rows.find((r) => r.ddoCode === DDO_CODE);
    expect(row).toBeDefined();
    expect(row!.name).toBe("Drawing & Disbursing Officer (Zonal Test)");
    expect(row!.paoCode).toBe(PAO_CODE);
    expect(row!.isActive).toBe(true);
    await q.stop();
  });

  it("re-sync (same paoCode, changed name/ministry) updates the SAME finance_pao row -- not a duplicate", async () => {
    const q = tenantWrappedQueue();
    registerMastersConsumers(q);
    await q.start();

    await q.publish("finance.masters.pao_sync", makeMsg("finance.masters.pao_sync", {
      tenantId: TENANT, paoCode: PAO_CODE, name: "Pay & Accounts Office (Original)",
      ministry: "Ministry of Test Affairs", source: "pfms",
    }));
    await q.drain();
    const firstRows = await runWithTenant(TENANT, () => repo.listPao(TENANT));
    const first = firstRows.find((r) => r.paoCode === PAO_CODE)!;
    expect(first).toBeDefined();

    await q.publish("finance.masters.pao_sync", makeMsg("finance.masters.pao_sync", {
      tenantId: TENANT, paoCode: PAO_CODE, name: "Pay & Accounts Office (Renamed)",
      ministry: "Ministry of Renamed Affairs", source: "pfms",
    }));
    await q.drain();

    expect(q.dlq.length).toBe(0);
    const secondRows = await runWithTenant(TENANT, () => repo.listPao(TENANT));
    const matching = secondRows.filter((r) => r.paoCode === PAO_CODE);
    expect(matching.length).toBe(1);
    expect(matching[0]!.id).toBe(first.id);
    expect(matching[0]!.name).toBe("Pay & Accounts Office (Renamed)");
    expect(matching[0]!.ministry).toBe("Ministry of Renamed Affairs");
    expect(matching[0]!.version).toBe(first.version + 1);
    await q.stop();
  });

  it("re-sync (same ddoCode, changed name/paoCode) updates the SAME finance_ddo row -- not a duplicate", async () => {
    const q = tenantWrappedQueue();
    registerMastersConsumers(q);
    await q.start();

    await q.publish("finance.masters.ddo_sync", makeMsg("finance.masters.ddo_sync", {
      tenantId: TENANT, ddoCode: DDO_CODE, name: "DDO (Original)", paoCode: PAO_CODE, source: "pfms",
    }));
    await q.drain();
    const firstRows = await runWithTenant(TENANT, () => repo.listDdo(TENANT));
    const first = firstRows.find((r) => r.ddoCode === DDO_CODE)!;
    expect(first).toBeDefined();

    await q.publish("finance.masters.ddo_sync", makeMsg("finance.masters.ddo_sync", {
      tenantId: TENANT, ddoCode: DDO_CODE, name: "DDO (Renamed)", paoCode: "PAOZT02", source: "pfms",
    }));
    await q.drain();

    expect(q.dlq.length).toBe(0);
    const secondRows = await runWithTenant(TENANT, () => repo.listDdo(TENANT));
    const matching = secondRows.filter((r) => r.ddoCode === DDO_CODE);
    expect(matching.length).toBe(1);
    expect(matching[0]!.id).toBe(first.id);
    expect(matching[0]!.name).toBe("DDO (Renamed)");
    expect(matching[0]!.paoCode).toBe("PAOZT02");
    expect(matching[0]!.version).toBe(first.version + 1);
    await q.stop();
  });

  it("CRITICAL BUG REGRESSION (pao_sync): an incomplete payload (today's only real caller shape -- {tenantId, source}) must NOT silently report success while writing nothing; it fails loudly and traceably instead", async () => {
    const q = tenantWrappedQueue({ maxAttempts: 1 });
    registerMastersConsumers(q);
    await q.start();

    await q.publish("finance.masters.pao_sync", makeMsg("finance.masters.pao_sync", {
      tenantId: TENANT, source: "pfms",
    }));
    await q.drain();

    // Before the fix, this "succeeded": the audit log + finance.masters.synced
    // notification both fired, and GET /v1/finance/pao stayed {"data":[]}
    // forever with no trace anywhere of why. Now: no row, AND a DLQ entry --
    // an honest, debuggable failure instead of a silent lie.
    const rows = await runWithTenant(TENANT, () => repo.listPao(TENANT));
    expect(rows.find((r) => r.paoCode === PAO_CODE)).toBeUndefined();
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]!.error).toContain("PAO_SYNC_PAYLOAD_INCOMPLETE");
    await q.stop();
  });

  it("CRITICAL BUG REGRESSION (ddo_sync): an incomplete payload (today's only real caller shape -- {tenantId, source}) must NOT silently report success while writing nothing; it fails loudly and traceably instead", async () => {
    const q = tenantWrappedQueue({ maxAttempts: 1 });
    registerMastersConsumers(q);
    await q.start();

    await q.publish("finance.masters.ddo_sync", makeMsg("finance.masters.ddo_sync", {
      tenantId: TENANT, source: "cga",
    }));
    await q.drain();

    const rows = await runWithTenant(TENANT, () => repo.listDdo(TENANT));
    expect(rows.find((r) => r.ddoCode === DDO_CODE)).toBeUndefined();
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]!.error).toContain("DDO_SYNC_PAYLOAD_INCOMPLETE");
    await q.stop();
  });

  it("LIVE HTTP CHECK: after real pao_sync/ddo_sync events, GET /v1/finance/pao and /v1/finance/ddo actually return the synced rows (not the permanent {\"data\":[]} the bug produced)", async () => {
    // Deliberately two independent steps, not one shared in-process queue:
    // in production the HTTP server and the worker are separate processes,
    // each with its OWN in-memory queue under QUEUE_DRIVER=memory, so
    // publishing through one would never reach a consumer registered on the
    // other. Step 1 (registerMastersConsumers on its own MemoryQueue) plays
    // the worker's role and performs the real write against Postgres. Step 2
    // (buildApp().inject()) plays the HTTP server's role and independently
    // reads that same Postgres row back through the real GET routes
    // (routes.ts -> repo.listPao/listDdo) -- exactly what production does,
    // since the two processes only ever share the database, never the queue.
    const q = tenantWrappedQueue();
    registerMastersConsumers(q);
    await q.start();
    await q.publish("finance.masters.pao_sync", makeMsg("finance.masters.pao_sync", {
      tenantId: TENANT, paoCode: PAO_CODE, name: "Pay & Accounts Office (HTTP Check)",
      ministry: "Ministry of Test Affairs", source: "pfms",
    }));
    await q.publish("finance.masters.ddo_sync", makeMsg("finance.masters.ddo_sync", {
      tenantId: TENANT, ddoCode: DDO_CODE, name: "DDO (HTTP Check)", paoCode: PAO_CODE, source: "pfms",
    }));
    await q.drain();
    expect(q.dlq.length).toBe(0);
    await q.stop();

    const app = await buildApp();
    try {
      const paoRes = await app.inject({ method: "GET", url: "/v1/finance/pao", headers: financeAdmin() });
      expect(paoRes.statusCode).toBe(200);
      const paoRow = paoRes.json().data.find((r: { paoCode: string }) => r.paoCode === PAO_CODE);
      expect(paoRow).toBeDefined();
      expect(paoRow.name).toBe("Pay & Accounts Office (HTTP Check)");
      expect(paoRow.ministry).toBe("Ministry of Test Affairs");
      expect(paoRow.isActive).toBe(true);

      const ddoRes = await app.inject({ method: "GET", url: "/v1/finance/ddo", headers: financeAdmin() });
      expect(ddoRes.statusCode).toBe(200);
      const ddoRow = ddoRes.json().data.find((r: { ddoCode: string }) => r.ddoCode === DDO_CODE);
      expect(ddoRow).toBeDefined();
      expect(ddoRow.name).toBe("DDO (HTTP Check)");
      expect(ddoRow.paoCode).toBe(PAO_CODE);
      expect(ddoRow.isActive).toBe(true);
    } finally {
      await app.close();
    }
  });
});
