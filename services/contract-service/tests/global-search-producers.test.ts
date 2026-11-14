/** Contracts -> cross-module search (real DB): flag-off parity, upsert on create/status change, no commercial data in the event. */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { runGlobalSearchCli, type GlobalSearchDocument } from "@civitasone/search";
import { db, sqlClient } from "../src/shared/db.js";
import { insertContract, updateContract } from "../src/modules/contracts/repo.js";
import { backfillEntities } from "../src/shared/global-search.js";

const T = "eeeeeeee-5ea0-4000-8000-000000000001";
const ACTOR = "00000000-5ea0-4000-8000-0000000000a1";
const saved = { ...process.env };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const scoped = <R,>(fn: (tx: any) => Promise<R>) => withTenantScope(db, T, fn as never) as Promise<R>;
const events = async () => (await scoped((tx) => tx.execute(sql`
  SELECT payload FROM _outbox.messages WHERE tenant_id = ${T}::uuid AND topic = 'search.index.update' ORDER BY created_at, id`))) as unknown as Array<{ payload: Record<string, unknown> }>;
const wipe = () => scoped((tx) => tx.execute(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${T}::uuid`));
const run = randomUUID().slice(0, 8);
const row = (no: string) => ({
  id: randomUUID(), tenantId: T, contractNo: `${no}-${run}`, vendorId: randomUUID(), poRef: "PO-SECRET-REF", title: "Annual road maintenance", valueMinor: 987654321n,
  startDate: "2026-04-01", expiry: "2027-03-31", slaTerms: { penalty: "confidential clause" }, createdBy: ACTOR, updatedBy: ACTOR,
}) as Parameters<typeof insertContract>[1];

describe("contracts -> global search producers (real DB)", () => {
  beforeEach(async () => { delete process.env.GLOBAL_SEARCH_TENANTS; await wipe(); });
  afterEach(() => { process.env = { ...saved }; });
  afterAll(async () => {
    await wipe();
    await scoped((tx) => tx.execute(sql`DELETE FROM contracts.contract_contracts WHERE tenant_id = ${T}::uuid`)).catch(() => undefined);
    await sqlClient.end();
  });

  it("flag off: no event", async () => {
    await scoped((tx) => insertContract(tx, row("CON-OFF")));
    expect(await events()).toEqual([]);
  });
  it("flag on: upsert on create and on status change; value, vendor, PO ref and SLA terms never leave the service", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    const r = row("CON-1");
    await scoped((tx) => insertContract(tx, r));
    await scoped((tx) => updateContract(tx, r.id!, { status: "active", updatedBy: ACTOR }));
    const ev = (await events()).map((e) => e.payload);
    expect(ev.map((p) => p.status)).toEqual(["draft", "active"]);
    expect(ev[0]).toMatchObject({ entityType: "contracts.contract", module: "contracts", name: "Annual road maintenance", refNumber: `CON-1-${run}`, tenantId: T });
    const wire = JSON.stringify(ev);
    for (const s of ["987654321", "PO-SECRET-REF", "confidential clause", r.vendorId as string]) expect(wire).not.toContain(s);
  });
  it("backfill dry run counts the tenant's contracts and writes nothing", async () => {
    await scoped((tx) => insertContract(tx, row("CON-BF")));
    const docs: GlobalSearchDocument[] = [];
    const idx = { initialize: async () => undefined, upsert: async (d: GlobalSearchDocument[]) => { docs.push(...d); return 1; }, removeTenant: async () => 1, waitForTask: async () => undefined };
    const withTenant = ((fn: (tx: never) => Promise<unknown>) => withTenantScope(db, T, (tx) => fn(tx as never))) as never;
    const [r] = await runGlobalSearchCli(["--tenant", T], (t) => backfillEntities(t, withTenant), { out: () => undefined }, idx);
    expect(r!.dryRun).toBe(true);
    expect(r!.scanned).toBeGreaterThanOrEqual(1);
    expect(docs).toEqual([]);
  });
});
