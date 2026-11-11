/** Procurement -> cross-module search (real DB): flag-off parity, indent/PO upserts on create and status change. */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { insertIndent, updateIndent } from "../src/modules/indent/repo.js";
import { insertPo, updatePo } from "../src/modules/po/repo.js";

const T = "dddddddd-5ea0-4000-8000-000000000001";
const ACTOR = "00000000-5ea0-4000-8000-0000000000a1";
const saved = { ...process.env };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const scoped = <R,>(fn: (tx: any) => Promise<R>) => withTenantScope(db, T, fn as never) as Promise<R>;
const events = async () => (await scoped((tx) => tx.execute(sql`
  SELECT payload FROM _outbox.messages WHERE tenant_id = ${T}::uuid AND topic = 'search.index.update' ORDER BY created_at, id`))) as unknown as Array<{ payload: Record<string, unknown> }>;
const wipe = () => scoped((tx) => tx.execute(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${T}::uuid`));

const run = randomUUID().slice(0, 8);
const indent = (no: string) => ({ id: randomUUID(), tenantId: T, indentNo: `${no}-${run}`, department: "Works", purpose: "Road repair", createdBy: ACTOR, updatedBy: ACTOR }) as Parameters<typeof insertIndent>[1];
const po = (no: string) => ({ id: randomUUID(), tenantId: T, poNo: `${no}-${run}`, vendorId: randomUUID(), indentRef: "IND-1", createdBy: ACTOR, updatedBy: ACTOR }) as Parameters<typeof insertPo>[1];

describe("procurement -> global search producers (real DB)", () => {
  beforeEach(async () => { delete process.env.GLOBAL_SEARCH_TENANTS; await wipe(); });
  afterEach(() => { process.env = { ...saved }; });
  afterAll(async () => {
    await wipe();
    await scoped(async (tx) => { await tx.execute(sql`DELETE FROM indent.procurement_indents WHERE tenant_id = ${T}::uuid`); await tx.execute(sql`DELETE FROM po.procurement_pos WHERE tenant_id = ${T}::uuid`); }).catch(() => undefined);
    await sqlClient.end();
  });

  it("flag off: no event", async () => {
    await scoped((tx) => insertIndent(tx, indent("IND-OFF")));
    await scoped((tx) => insertPo(tx, po("PO-OFF")));
    expect(await events()).toEqual([]);
  });
  it("flag on: indent and PO upserts, then the status change", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    const i = indent("IND/2026/001"); const p = po("PO/2026/001");
    await scoped((tx) => insertIndent(tx, i));
    await scoped((tx) => updateIndent(tx, i.id!, { status: "approved", updatedBy: ACTOR }));
    await scoped((tx) => insertPo(tx, p));
    await scoped((tx) => updatePo(tx, p.id!, { status: "approved", updatedBy: ACTOR }));
    const ev = (await events()).map((e) => e.payload);
    expect(ev.map((x) => [x.entityType, x.status])).toEqual([["procurement.indent", "draft"], ["procurement.indent", "approved"], ["procurement.po", "draft"], ["procurement.po", "approved"]]);
    expect(ev[2]).toMatchObject({ module: "procurement", refNumber: `PO/2026/001-${run}`, tenantId: T });
  });
});
