/**
 * UAT b24: the poCreate worker treated EVERY non-2xx from finance-service's sanctions/:id/available as a retryable
 * outage, so a permanent 4xx (unknown sanction, bad id, wrong service credentials) was retried 5x and dead-lettered
 * with the maker never told. Now: 404 -> the maker gets po.budget_exceeded SANCTION_NOT_FOUND, other 4xx ->
 * NonRetryable, 5xx/408/429/network -> still retryable.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NonRetryableError } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { procurementPos } from "../src/modules/po/schema.js";
import { registerPoConsumers } from "../src/modules/po/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const handlers = new Map<string, (m: unknown) => Promise<void>>();
registerPoConsumers({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); } } as never);

afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await sqlClient.end(); });

function finance(status: number) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ code: "X" }), { status, headers: { "content-type": "application/json" } }));
}
function poMsg(poId: string) {
  return {
    messageId: randomUUID(), type: COMMANDS.poCreate, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: {
      id: poId, tenantId: TENANT, poNo: "AUTO", vendorId: randomUUID(), indentRef: `procurement_indent:${randomUUID()}`,
      sanctionRef: `finance_sanction:${randomUUID()}`,
      items: [{ itemCode: "STN-01", description: "A4 copier paper, 75 GSM", quantity: 40, unit: "ream", unitPriceMinor: 31000 }],
    },
  };
}
const attempt = (m: ReturnType<typeof poMsg>) => runWithTenant(TENANT, () => handlers.get(COMMANDS.poCreate)!(m)).then(() => null, (e: unknown) => e);

describe("poCreate: finance-service answers the sanction check with a 4xx", () => {
  it("404 -> the maker is told (po.budget_exceeded SANCTION_NOT_FOUND), no PO, no retry", async () => {
    finance(404);
    const m = poMsg(randomUUID());
    expect(await attempt(m)).toBeNull();
    const events = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    const ev = events.find((r) => r.eventType === EVENTS.poBudgetExceeded);
    expect(ev).toBeDefined();
    expect((ev!.payload as { code: string }).code).toBe("SANCTION_NOT_FOUND");
    const pos = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(procurementPos).where(eq(procurementPos.id, m.payload.id))));
    expect(pos).toHaveLength(0);
  });

  it.each([400, 401, 403, 422])("%i -> NonRetryableError (one DLQ entry, not five retries)", async (status) => {
    finance(status);
    const err = await attempt(poMsg(randomUUID()));
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(String((err as Error).message)).toContain(String(status));
  });

  it.each([408, 429, 500, 503])("%i -> still retryable", async (status) => {
    finance(status);
    const err = await attempt(poMsg(randomUUID()));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NonRetryableError);
    expect((err as Error).name).toBe("FinanceUnavailableError");
  });
});
