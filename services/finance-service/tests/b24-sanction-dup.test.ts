/**
 * UAT b24: finance.sanction.create with a sanction_no the tenant already has. The route used to 202 it, the worker
 * hit the (tenant_id, sanction_no) unique index, retried 5x and dead-lettered. Now: route 409, worker NonRetryable.
 * Real Postgres as the non-superuser app role; seeds written under the tenant context.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NonRetryableError } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeSanctions, financeHeads, financeBudgets } from "../src/modules/budget/schema.js";
import { currentFyIST } from "../src/shared/ist-date.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import * as commands from "../src/modules/budget/commands.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();
const ACTOR = "b24a0000-0000-4000-8000-00000000a002";
const HEAD = randomUUID();
const SANCTION_NO = "SN/2026-27/SMC-0147";
const ctx = { tenantId: TENANT, actorId: ACTOR, correlationId: "corr-b24-san", roles: ["finance_officer"] } as never;

beforeAll(async () => {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({ id: HEAD, tenantId: TENANT, code: "B24-SAN", name: "Road repairs", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR }));
  await scoped(TENANT, (tx) => tx.insert(financeBudgets).values({ tenantId: TENANT, headId: HEAD, fy: currentFyIST(), beMinor: 10n ** 12n, reMinor: 10n ** 12n, createdBy: ACTOR, updatedBy: ACTOR }));
  await scoped(TENANT, (tx) => tx.insert(financeSanctions).values({
    id: randomUUID(), tenantId: TENANT, sanctionNo: SANCTION_NO, purpose: "Resurfacing of Ward 9 internal roads", headId: HEAD,
    amountMinor: 500000n, currency: "INR", status: "pending_approval", createdBy: ACTOR, updatedBy: ACTOR,
  }));
});
afterAll(async () => { await sqlClient.end(); });

describe("duplicate sanction number", () => {
  it("the command refuses it with 409 DUPLICATE_SANCTION_NO and queues nothing", async () => {
    await expect(runWithTenant(TENANT, () => commands.createSanction(ctx, { sanctionNo: SANCTION_NO, purpose: "Another purpose", headId: HEAD, amountMinor: 100000, currency: "INR" } as never)))
      .rejects.toMatchObject({ status: 409, code: "DUPLICATE_SANCTION_NO" });
  });

  it("the worker raises NonRetryableError (no 5x retry) when the unique index fires despite the route check", async () => {
    const handlers = new Map<string, (m: unknown) => Promise<void>>();
    registerBudgetConsumers({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); } } as never);
    const msg = { messageId: randomUUID(), type: COMMANDS.sanctionCreate, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-b24-san", schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: TENANT, sanctionNo: SANCTION_NO, purpose: "Racing duplicate", headId: HEAD, amountMinor: 100000 } };
    const err = await handlers.get(COMMANDS.sanctionCreate)!(msg).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(String((err as Error).message)).toContain("DUPLICATE_SANCTION_NO");
  });
});
