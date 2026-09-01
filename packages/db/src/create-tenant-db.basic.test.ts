import { describe, it, expect, afterEach } from "vitest";
import { createTenantDb } from "./create-tenant-db.js";
import { createTenantDb as createTenantDbFromBarrel, createDb } from "./index.js";
import { TenantRouter } from "./tenant-router.js";

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

describe("createTenantDb — db/sqlClient binding identity is stable and unchanged", () => {
  it("t.db and t.sqlClient are the exact same references on every access (no re-creation)", () => {
    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });

    // Repeated property reads must return the identical binding, not a fresh
    // instance — these are the same references route/consumer/repo call sites
    // import once and hold onto.
    expect(t.db).toBe(t.db);
    expect(t.sqlClient).toBe(t.sqlClient);
    expect(t.router).toBe(t.router);
    expect(t.router).toBeInstanceOf(TenantRouter);

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });

  it("two independent createTenantDb() calls never share sqlClient/db bindings", () => {
    const a = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db-a" });
    const b = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db-b" });

    expect(a.sqlClient).not.toBe(b.sqlClient);
    expect(a.db).not.toBe(b.db);
    expect(a.router).not.toBe(b.router);

    void a.sqlClient.end({ timeout: 0 }).catch(() => undefined);
    void b.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });

  it("t.sqlClientFor(pool tenant) returns the same sqlClient identity across repeated calls", async () => {
    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });

    const first = await t.sqlClientFor(T_POOL);
    const second = await t.sqlClientFor(T_POOL);
    expect(first).toBe(t.sqlClient);
    expect(second).toBe(t.sqlClient);
    expect(first).toBe(second);

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });
});

describe("createTenantDb — dbFor/tierOf/dbForRead shape assertions", () => {
  it("dbFor(tenantId) resolves to a Drizzle-shaped db (select/insert/transaction/execute functions)", async () => {
    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });
    const db = await t.dbFor(T_POOL);

    expect(typeof db.select).toBe("function");
    expect(typeof db.insert).toBe("function");
    expect(typeof db.update).toBe("function");
    expect(typeof db.delete).toBe("function");
    expect(typeof db.transaction).toBe("function");
    expect(typeof db.execute).toBe("function");

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });

  it("t.db (module-level pool binding) has the same Drizzle shape as dbFor(pool tenant)", async () => {
    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });
    const dbForPool = await t.dbFor(T_POOL);

    for (const key of ["select", "insert", "update", "delete", "transaction", "execute"] as const) {
      expect(typeof t.db[key]).toBe(typeof dbForPool[key]);
      expect(typeof t.db[key]).toBe("function");
    }

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });

  it("dbFor(tenantId) is wrapped with tenant-GUC injection, same as db (regression guard)", async () => {
    // wrapWithTenantGuc() returns Object.create(rawDb) with `transaction`
    // reassigned as an OWN property of the wrapper. A raw, unwrapped Drizzle
    // instance inherits `transaction` from its class prototype instead, so
    // `transaction` is NOT its own property. This distinguishes "wrapped"
    // from "raw" without needing a live transaction / real Postgres —
    // exactly the distinction that matters here: dbFor() used to return the
    // raw (unwrapped) instance, so its transaction() never set app.tenant_id,
    // silently skipping RLS scoping for every FORCE ROW LEVEL SECURITY table.
    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });
    const dbForPool = await t.dbFor(T_POOL);

    expect(Object.prototype.hasOwnProperty.call(t.db, "transaction")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(dbForPool, "transaction")).toBe(true);

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });

  it("dbForRead(tenantId) is likewise wrapped with tenant-GUC injection on the no-replica fallback path", async () => {
    const prevReplica = process.env.DATABASE_REPLICA_URL;
    delete process.env.DATABASE_REPLICA_URL;

    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });
    const dbForReadResult = await t.dbForRead(T_POOL);

    expect(Object.prototype.hasOwnProperty.call(dbForReadResult, "transaction")).toBe(true);

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
    if (prevReplica === undefined) delete process.env.DATABASE_REPLICA_URL;
    else process.env.DATABASE_REPLICA_URL = prevReplica;
  });

  it("tierOf(tenantId) resolves to one of the three known TenantTier string literals", async () => {
    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });
    const tier = await t.tierOf(T_POOL);

    expect(typeof tier).toBe("string");
    expect(["pool", "silo", "shard"]).toContain(tier);

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
  });

  it("dbForRead(tenantId) falls back to dbFor's exact db instance when no replica is configured", async () => {
    const prevReplica = process.env.DATABASE_REPLICA_URL;
    delete process.env.DATABASE_REPLICA_URL;

    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });
    const dbForResult = await t.dbFor(T_POOL);
    const dbForReadResult = await t.dbForRead(T_POOL);

    // Req 8.2: no replica configured behaves identically to dbFor — same cached
    // Drizzle instance for the pool tenant, not merely shape-equal.
    expect(dbForReadResult).toBe(dbForResult);

    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
    if (prevReplica === undefined) delete process.env.DATABASE_REPLICA_URL;
    else process.env.DATABASE_REPLICA_URL = prevReplica;
  });

  it("dbForRead(tenantId) rejects a non-UUID tenantId with a descriptive error (same shape as dbFor)", async () => {
    const t = createTenantDb({ schema: SCHEMA, poolDsn: "postgres://user:pw@host/db" });
    await expect(t.dbForRead("not-a-uuid")).rejects.toThrow(
      /createTenantDb.dbForRead: invalid tenantId/,
    );
    void t.sqlClient.end({ timeout: 0 }).catch(() => undefined);
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
