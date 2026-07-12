import { describe, it, expect, afterEach } from "vitest";
import { createTenantDb } from "./create-tenant-db.js";
import { createTenantDb as createTenantDbFromBarrel, createDb } from "./index.js";

const T_POOL = "11111111-1111-1111-1111-111111111111";
const T_SILO = "22222222-2222-2222-2222-222222222222";

// Minimal fake schema — createTenantDb is generic over the schema shape and
// never queries it directly at construction time.
const SCHEMA = {} as Record<string, unknown>;

describe("createTenantDb — module load / config", () => {
  const prevDbUrl = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.DATABASE_URL = prevDbUrl;
  });

  it("throws a descriptive error when no DATABASE_URL/poolDsn is configured", () => {
    delete process.env.DATABASE_URL;
    expect(() => createTenantDb({ schema: SCHEMA })).toThrow(/DATABASE_URL is required/);
  });

  it("builds successfully from an explicit poolDsn (env DATABASE_URL absent)", () => {
    delete process.env.DATABASE_URL;
    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });
    expect(t.sqlClient).toBeDefined();
    expect(t.db).toBeDefined();
    expect(t.router).toBeDefined();
    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });

  it("builds successfully from process.env.DATABASE_URL when poolDsn is omitted", () => {
    process.env.DATABASE_URL = "postgres://user:pw@host/env-db";
    const t = createTenantDb({ schema: SCHEMA });
    expect(t.sqlClient).toBeDefined();
    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });
});

describe("createTenantDb — db/sqlClient identity and dbFor/tierOf happy path", () => {
  it("dbFor/sqlClientFor for a pool tenant resolve to the exact same sqlClient (no second connection)", async () => {
    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });
    const client = await t.sqlClientFor(T_POOL);
    expect(client).toBe(t.sqlClient);

    const tier = await t.tierOf(T_POOL);
    expect(tier).toBe("pool");

    const db1 = await t.dbFor(T_POOL);
    const db2 = await t.dbFor(T_POOL);
    expect(db1).toBe(db2); // cached per underlying client (WeakMap)
    expect(db1).toBeDefined();

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });

  it("routes a silo-configured tenant to a distinct client via a custom resolver", async () => {
    const t = createTenantDb({
      schema: SCHEMA,
      poolDsn: "postgres://user:pw@host/db",
      resolver: (tenantId) =>
        tenantId === T_SILO
          ? { tier: "silo", connectionString: "postgres://user:pw@silo-host/tenant-db" }
          : { tier: "pool" },
    });

    const siloClient = await t.sqlClientFor(T_SILO);
    expect(siloClient).not.toBe(t.sqlClient);

    const tier = await t.tierOf(T_SILO);
    expect(tier).toBe("silo");

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
    void siloClient.end({ timeout: 0 }).catch(() => undefined);
  });
});

describe("@civitasone/db barrel export (index.ts)", () => {
  it("re-exports createTenantDb identically to the direct module", () => {
    expect(createTenantDbFromBarrel).toBe(createTenantDb);
  });

  it("createDb() builds a drizzle db bound to a fresh sqlClient", () => {
    const db = createDb(SCHEMA, "postgres://user:pw@host/db");
    expect(db).toBeDefined();
  });
});

describe("createTenantDb — UUID rejection error path", () => {
  it("sqlClientFor rejects a non-UUID tenantId with a descriptive error", async () => {
    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });
    await expect(t.sqlClientFor("not-a-uuid")).rejects.toThrow(
      /createTenantDb.sqlClientFor: invalid tenantId/,
    );
    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });

  it("dbFor rejects a non-UUID tenantId with a descriptive error", async () => {
    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });
    await expect(t.dbFor("not-a-uuid")).rejects.toThrow(/createTenantDb.dbFor: invalid tenantId/);
    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });

  it("tierOf rejects a non-UUID tenantId with a descriptive error", async () => {
    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });
    await expect(t.tierOf("not-a-uuid")).rejects.toThrow(/createTenantDb.tierOf: invalid tenantId/);
    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });
});
