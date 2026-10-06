/**
 * GAP-PROCUREMENT-TENDERS-NEW-01 / 02:
 *  - 01: a tender carries an opaque indentRef linking it to its authorising
 *    indent, and the GFR mode band for its estimated value is enforced at
 *    create (assertModeAllowedForValue — exercised in gfr-bands.test.ts; here we
 *    confirm indentRef + openingDate persist).
 *  - 02: a single_source tender MUST carry a recorded justification (category +
 *    reason + approving authority); the validator rejects one that doesn't, and
 *    the consumer persists the fields when it does.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler, SubscribeOptions } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementTenders } from "../src/modules/tender/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerTenderConsumers } from "../src/modules/tender/consumer.js";
import { createTenderBody } from "../src/modules/tender/validators.js";
import { COMMANDS } from "../src/topics.js";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = "7a700000-aaaa-4000-8000-00000000c1f0";
const ACTOR = "7a700000-bbbb-4000-8000-00000000c1f1";

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler, o?: SubscribeOptions) => raw(t, withTenantConsumer(h) as Handler, o)) as typeof q.subscribe;
  return q;
}
function msg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `c-${type}`, schemaVersion: "1.0", payload };
}
async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, TENANT));
  }));
}

beforeAll(wipe);
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("createTenderBody validator (GAP-PROCUREMENT-TENDERS-NEW-02)", () => {
  it("rejects a single_source tender with no justification", () => {
    const r = createTenderBody.safeParse({ title: "Proprietary kit", type: "single_source", estimatedMinor: 40_000_000, bidClosingDate: "2999-01-01" });
    expect(r.success).toBe(false);
  });
  it("accepts a single_source tender that records category + reason + authority", () => {
    const r = createTenderBody.safeParse({
      title: "Proprietary kit", type: "single_source", estimatedMinor: 40_000_000, bidClosingDate: "2999-01-01",
      justificationCategory: "proprietary", justification: "Sole manufacturer of this spare part.", approvingAuthority: "Chief Engineer",
    });
    expect(r.success).toBe(true);
  });
  it("accepts an open tender with no justification (only single_source needs one)", () => {
    const r = createTenderBody.safeParse({ title: "Open tender", type: "open", estimatedMinor: 40_000_000, bidClosingDate: "2999-01-01" });
    expect(r.success).toBe(true);
  });
});

describe("tenderCreate consumer (GAP-PROCUREMENT-TENDERS-NEW-01/02/04)", () => {
  it("persists indentRef, openingDate and single-source justification", async () => {
    const id = randomUUID();
    const q = wire(new MemoryQueue());
    registerTenderConsumers(q);
    await q.start();
    await q.publish(COMMANDS.tenderCreate, msg(COMMANDS.tenderCreate, {
      id, tenantId: TENANT, title: "Single-source kit", type: "single_source",
      estimatedMinor: 40_000_000, emdAmountMinor: 0, bidClosingDate: "2999-01-01", openingDate: "2999-01-15",
      indentRef: "procurement_indent:11111111-1111-4000-8000-000000000001",
      justificationCategory: "proprietary", justification: "Sole manufacturer.", approvingAuthority: "Chief Engineer",
    }));
    await (q as MemoryQueue).drain();
    await (q as MemoryQueue).stop();

    const row = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementTenders).where(eq(procurementTenders.id, id))
    )))[0];
    expect(row?.status).toBe("draft");
    expect(row?.indentRef).toBe("procurement_indent:11111111-1111-4000-8000-000000000001");
    expect(row?.openingDate).toBe("2999-01-15");
    expect(row?.justificationCategory).toBe("proprietary");
    expect(row?.justification).toBe("Sole manufacturer.");
    expect(row?.approvingAuthority).toBe("Chief Engineer");
  });
});

describe("POST /v1/procurement/tenders — synchronous guards (GAP-PROCUREMENT-TENDERS-NEW-06)", () => {
  let app: FastifyInstance;
  const auth = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_admin", "super_admin"], sid: "s-create" }, SECRET, 3600)}` };
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it("rejects a bid closing date in the past with 422", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/tenders", headers: auth,
      payload: { title: "Past tender", type: "open", estimatedMinor: 600000000, bidClosingDate: "2000-01-01" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CLOSING_DATE_PAST");
  });

  it("accepts a future closing date with 202 (tenderNo is server-issued async)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/tenders", headers: auth,
      payload: { title: "Future tender", type: "open", estimatedMinor: 600000000, bidClosingDate: "2099-04-01" },
    });
    expect(res.statusCode).toBe(202);
  });
});
