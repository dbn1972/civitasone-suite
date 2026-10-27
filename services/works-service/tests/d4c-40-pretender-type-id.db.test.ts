/**
 * Owner decision D4c #40 (GAP-WORKS-TENDERS-NEW-03): a pre-tender is saved against its tender-type MASTER record
 * (nullable tender_type_id); the text tender_type stays for old records. Real Postgres (works_svc, FORCE RLS).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { preTenders } from "../src/modules/tender/schema.js";
import { tenderTypes } from "../src/modules/masters/schema.js";
import { registerTenderConsumers } from "../src/modules/tender/consumer.js";
import { getActiveTenderType } from "../src/modules/tender/repo.js";

const TENANT = `d4c40000-0000-4000-8000-${randomUUID().slice(24)}`;
const OTHER = `d4c40000-0000-4000-8000-${randomUUID().slice(24)}`;
const ACTOR = randomUUID();

type Handler = (msg: unknown) => Promise<void>;
const handlers: Record<string, Handler> = {};
registerTenderConsumers({ subscribe: (t: string, fn: Handler) => { handlers[t] = fn; } } as never);
const deliver = (payload: Record<string, unknown>, tenant = TENANT) =>
  runWithTenant(tenant, () => handlers[COMMANDS.preTenderCreate]!({
    messageId: randomUUID(), tenantId: tenant, actorId: ACTOR, correlationId: "d4c40", schemaVersion: "1.0", payload,
  }));
const inTx = <T>(tenant: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(tenant, () => db.transaction(fn));

async function seedType(tenant: string, active = true, name = "Open e-Tender") {
  const id = randomUUID();
  await inTx(tenant, (tx) => tx.insert(tenderTypes).values({ id, tenantId: tenant, name, rateType: "percentage_rate", active }));
  return id;
}
const rowOf = (id: string) => inTx(TENANT, async (tx) => (await tx.select().from(preTenders).where(eq(preTenders.id, id)))[0]);

afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${t}, true)`;
      for (const tbl of ["works.pre_tenders", "works.tender_types"]) await sql.unsafe(`DELETE FROM ${tbl} WHERE tenant_id = '${t}'`);
    });
  }
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id IN (${TENANT}, ${OTHER})`;
  await sqlClient.end();
});

describe("pre-tender saved by tender-type master (real DB)", () => {
  it("stores tender_type_id and fills the text type from the master name when only the id is sent", async () => {
    const typeId = await seedType(TENANT);
    const id = randomUUID();
    await deliver({ id, workId: randomUUID(), tenderTypeId: typeId });
    const r = await rowOf(id);
    expect(r!.tenderTypeId).toBe(typeId);
    expect(r!.tenderType).toBe("Open e-Tender");
  });

  it("keeps the text the form sent beside the id", async () => {
    const typeId = await seedType(TENANT);
    const id = randomUUID();
    await deliver({ id, workId: randomUUID(), tenderTypeId: typeId, tenderType: "OPEN" });
    const r = await rowOf(id);
    expect(r!.tenderTypeId).toBe(typeId);
    expect(r!.tenderType).toBe("OPEN");
  });

  it("an old-style pre-tender with only the text code still saves, with a null tender_type_id", async () => {
    const id = randomUUID();
    await deliver({ id, workId: randomUUID(), tenderType: "LIMITED" });
    const r = await rowOf(id);
    expect(r!.tenderTypeId).toBeNull();
    expect(r!.tenderType).toBe("LIMITED");
  });

  it("refuses an unknown, inactive or other-tenant tender type and writes nothing", async () => {
    const inactive = await seedType(TENANT, false);
    const foreign = await seedType(OTHER);
    for (const bad of [randomUUID(), inactive, foreign]) {
      const id = randomUUID();
      await expect(deliver({ id, workId: randomUUID(), tenderTypeId: bad })).rejects.toThrow(/INVALID_TENDER_TYPE/);
      expect(await rowOf(id)).toBeUndefined();
    }
  });

  it("getActiveTenderType finds only an active type of the caller's tenant", async () => {
    const ok = await seedType(TENANT);
    const inactive = await seedType(TENANT, false);
    expect((await runWithTenant(TENANT, () => getActiveTenderType(TENANT, ok)))?.id).toBe(ok);
    expect(await runWithTenant(TENANT, () => getActiveTenderType(TENANT, inactive))).toBeNull();
    expect(await runWithTenant(TENANT, () => getActiveTenderType(TENANT, randomUUID()))).toBeNull();
  });
});
