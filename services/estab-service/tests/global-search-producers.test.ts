/** Establishment files -> cross-module search (real DB): only public, non-VIP files are indexed; others are removed. */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { insertFile, updateFile } from "../src/modules/files/repo.js";

const T = "ffffffff-5ea0-4000-8000-000000000001";
const ACTOR = "00000000-5ea0-4000-8000-0000000000a1";
const saved = { ...process.env };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const scoped = <R,>(fn: (tx: any) => Promise<R>) => withTenantScope(db, T, fn as never) as Promise<R>;
const events = async () => (await scoped((tx) => tx.execute(sql`
  SELECT payload FROM _outbox.messages WHERE tenant_id = ${T}::uuid AND topic = 'search.index.update' ORDER BY created_at, id`))) as unknown as Array<{ payload: Record<string, unknown> }>;
const wipe = () => scoped((tx) => tx.execute(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${T}::uuid`));
const run = randomUUID().slice(0, 8);
const file = (no: string, over: Record<string, unknown> = {}) => ({
  id: randomUUID(), tenantId: T, fileNo: `${no}-${run}`, subject: "Office space allotment", dept: "Administration", currentWith: ACTOR,
  vipReference: "VIP-SECRET", createdBy: ACTOR, updatedBy: ACTOR, ...over,
}) as Parameters<typeof insertFile>[1];

describe("estab files -> global search producers (real DB)", () => {
  beforeEach(async () => { delete process.env.GLOBAL_SEARCH_TENANTS; await wipe(); });
  afterEach(() => { process.env = { ...saved }; });
  afterAll(async () => {
    await wipe();
    await scoped((tx) => tx.execute(sql`DELETE FROM files.estab_files WHERE tenant_id = ${T}::uuid`)).catch(() => undefined);
    await sqlClient.end();
  });

  it("flag off: no event", async () => {
    await scoped((tx) => insertFile(tx, file("F-OFF")));
    expect(await events()).toEqual([]);
  });
  it("flag on: a public file is indexed with number, subject, department and status only", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    await scoped((tx) => insertFile(tx, file("F-1", { vipReference: "VIP-SECRET" })));
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ action: "upsert", entityType: "estab.file", module: "establishment", name: "Office space allotment", refNumber: `F-1-${run}`, description: "Administration" });
    expect(JSON.stringify(ev)).not.toContain("VIP-SECRET");
  });
  it("personal data typed into a file subject is redacted before it reaches the event", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    await scoped((tx) => insertFile(tx, file("F-PII", { subject: "Lease of ABCDE 1234 F, +91 98765 43210, acct 123456789012" })));
    const wire = JSON.stringify(await events());
    expect(wire).not.toMatch(/ABCDE|98765|123456789012/);
    expect(wire).toContain("[redacted]");
  });
  it("classified, VIP files are never indexed; a file that becomes classified is removed", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    await scoped((tx) => insertFile(tx, file("F-SEC", { classification: "secret" })));
    await scoped((tx) => insertFile(tx, file("F-VIP", { isVip: true })));
    const f = file("F-UP");
    await scoped((tx) => insertFile(tx, f));
    await scoped((tx) => updateFile(tx, f.id!, { classification: "confidential", updatedBy: ACTOR }));
    expect((await events()).map((e) => e.payload.action)).toEqual(["delete", "delete", "upsert", "delete"]);
  });
});
