/**
 * CLOS3-S4-05: opening a product version must never create two open (draft / pending_approval)
 * versions or two rows sharing a version_number, even when several openProductVersion commands
 * are published before any is consumed; and the route's open-version guard must not stop at the
 * newest 200 rows.
 *
 * Real Postgres as the non-superuser catalogue_svc role (FORCE RLS enforced). Fails loudly when
 * Postgres is unreachable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";

const DSN = process.env["DATABASE_URL"] ?? "";
async function probe(): Promise<boolean> {
  const client = postgres(DSN, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
  try { await client`SELECT 1 FROM catalogue.product_versions LIMIT 1`; return true; } catch { return false; }
  finally { await client.end({ timeout: 1 }).catch(() => undefined); }
}
const reachable = DSN !== "" && (await probe());
if (!reachable) throw new Error(`closure3-s4-05: Postgres not reachable (DATABASE_URL=${DSN === "" ? "unset" : DSN.replace(/:[^:@/]+@/, ":***@")}); CI bootstraps it, locally run scripts/ci/bootstrap-postgres.sh`);

const { db, sqlClient } = await import("../src/shared/db.js");
const { runWithTenant } = await import("@civitasone/db");
const { registerProductConsumers } = await import("../src/modules/products/consumer.js");
const gov = await import("../src/modules/products/governance-repo.js");
const { productVersions } = await import("../src/modules/products/governance-schema.js");
const { COMMANDS } = await import("../src/topics.js");

type Handler = (msg: unknown) => Promise<void>;
const handlers = new Map<string, Handler>();
registerProductConsumers({
  subscribe: (topic: string, h: Handler) => { handlers.set(topic, h); },
  publish: async () => undefined,
} as unknown as Queue);

const ACTOR = randomUUID();
const tenants: string[] = [];
const newTenant = (): string => { const t = randomUUID(); tenants.push(t); return t; };
const asTenant = <T>(t: string, fn: () => Promise<T>): Promise<T> => Promise.resolve(runWithTenant(t, fn));

function openMsg(tenantId: string, productId: string, versionNumber = 2) {
  const id = randomUUID();
  return { messageId: id, correlationId: "c", tenantId, actorId: ACTOR, payload: { id, productId, changeSummary: "chg", versionNumber } };
}
const open = (m: unknown) => handlers.get(COMMANDS.openProductVersion)!(m);
const versionsOf = (t: string, productId: string) =>
  asTenant(t, () => db.transaction((tx) => tx.select().from(productVersions).where(eq(productVersions.productId, productId))));
const addVersion = (t: string, productId: string, versionNumber: number, status: string) =>
  asTenant(t, () => db.transaction(async (tx) => {
    await tx.insert(productVersions).values({ tenantId: t, productId, versionNumber, status, createdBy: ACTOR });
  }));

describe("CLOS3-S4-05 product version open race (real Postgres)", () => {
  afterAll(async () => {
    for (const t of tenants) {
      await asTenant(t, () => db.transaction(async (tx) => { await tx.delete(productVersions).where(eq(productVersions.tenantId, t)); })).catch(() => undefined);
    }
    await sqlClient.end({ timeout: 5 }).catch(() => undefined);
  });

  it("two opens published before either is consumed create exactly one new open version", async () => {
    const t = newTenant(); const p = randomUUID();
    await addVersion(t, p, 1, "approved");
    await Promise.all([open(openMsg(t, p)), open(openMsg(t, p))]);
    const rows = await versionsOf(t, p);
    expect(rows.filter((r) => r.status === "draft" || r.status === "pending_approval")).toHaveLength(1);
    expect(new Set(rows.map((r) => r.versionNumber)).size).toBe(rows.length);
    expect(rows).toHaveLength(2);
  });

  it("an open command is dropped while a draft already exists", async () => {
    const t = newTenant(); const p = randomUUID();
    await addVersion(t, p, 1, "draft");
    await open(openMsg(t, p));
    expect(await versionsOf(t, p)).toHaveLength(1);
  });

  it("the consumer allocates max(version_number)+1 and ignores the supplied number", async () => {
    const t = newTenant(); const p = randomUUID();
    await addVersion(t, p, 1, "approved");
    await addVersion(t, p, 4, "rejected");
    await open(openMsg(t, p, 2));
    const nums = (await versionsOf(t, p)).map((r) => r.versionNumber).sort((a, b) => a - b);
    expect(nums).toEqual([1, 4, 5]);
  });

  it("the database rejects two versions with the same number for one product", async () => {
    const t = newTenant(); const p = randomUUID();
    await addVersion(t, p, 1, "approved");
    await expect(addVersion(t, p, 1, "rejected")).rejects.toThrow();
  });

  it("findOpenVersion sees an open version beyond the newest 200 rows", async () => {
    const t = newTenant(); const p = randomUUID();
    await asTenant(t, () => db.transaction(async (tx) => {
      const rows = Array.from({ length: 205 }, (_v, i) => ({
        tenantId: t, productId: p, versionNumber: i + 1, status: i === 0 ? "draft" : "approved", createdBy: ACTOR,
      }));
      await tx.insert(productVersions).values(rows);
    }));
    const found = await asTenant(t, () => gov.findOpenVersion(p, t));
    expect(found?.versionNumber).toBe(1);
  });
});
