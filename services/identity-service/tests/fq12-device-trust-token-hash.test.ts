/**
 * FQ12-SEC: device trust tokens were stored in plaintext in
 * devices.registered_devices.trust_token and compared with `!==`.
 *
 * Proves: only SHA-256(token) is stored (the column is gone), the token is
 * returned once at registration, step-up compares in constant time against the
 * hash, and migration 0031 backfills legacy plaintext rows and is idempotent
 * (applied twice, inside a rolled-back transaction so the shared test DB is
 * left untouched).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Queue, Handler } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as sharedQueue } from "../src/shared/infra.js";
import { registeredDevices } from "../src/modules/devices/schema.js";
import { registerDeviceConsumers } from "../src/modules/devices/consumer.js";
import { hashTrustToken, trustTokenMatches } from "../src/modules/devices/repo.js";

// mintTrustToken() reads this at call time; generated per run, never a literal.
process.env.DEVICE_TRUST_SECRET ??= randomBytes(32).toString("hex");

const JWT = process.env.JWT_SECRET as string;
const T = randomUUID();
const USER = randomUUID();
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function auth(): Record<string, string> {
  return { authorization: `Bearer ${signToken({ sub: USER, tid: T, roles: ["super_admin"], sid: `s-${randomUUID()}` } as never, JWT, 3600)}` };
}

async function waitFor<V>(fn: () => Promise<V>, ok: (v: V) => boolean, timeoutMs = 5000): Promise<V> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    last = await fn();
  }
  return last;
}

describe("hashTrustToken / trustTokenMatches", () => {
  it("matches only the exact token, in constant time over equal-length digests", () => {
    const token = randomUUID() + randomUUID();
    const h = hashTrustToken(token);
    expect(h).toBe(sha(token));
    expect(trustTokenMatches(h, token)).toBe(true);
    expect(trustTokenMatches(h, `${token}x`)).toBe(false);
    expect(trustTokenMatches(h, "")).toBe(false);
    expect(trustTokenMatches(null, token)).toBe(false);
    expect(trustTokenMatches("not-hex", token)).toBe(false);
    // The raw token is never accepted as if it were the stored value.
    expect(trustTokenMatches(token, token)).toBe(false);
  });
});

describe("device register / step-up against the DB", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
    const raw = sharedQueue.subscribe.bind(sharedQueue);
    (sharedQueue as Queue).subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof sharedQueue.subscribe;
    registerDeviceConsumers(sharedQueue);
    await sharedQueue.start();
  });
  afterAll(async () => {
    await runWithTenant(T, () => db.transaction((tx) => tx.delete(registeredDevices).where(eq(registeredDevices.tenantId, T))));
    await app.close();
  });

  it("stores only the hash; step-up accepts the token and rejects anything else", async () => {
    const deviceId = randomUUID();
    const reg = await app.inject({
      method: "POST", url: "/v1/devices/register", headers: auth(),
      payload: { deviceId, platform: "android", label: "fq12 phone", fingerprint: `sha256:${randomUUID()}` },
    });
    expect(reg.statusCode).toBe(202);
    const { trustToken } = reg.json() as { trustToken: string };
    expect(typeof trustToken).toBe("string");

    const rows = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(registeredDevices).where(eq(registeredDevices.id, deviceId)))),
      (r) => r.length === 1,
    );
    expect(rows[0]!.trustTokenHash).toBe(sha(trustToken));
    expect(JSON.stringify(rows[0])).not.toContain(trustToken);

    const cols = await sqlClient`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'devices' AND table_name = 'registered_devices' AND column_name LIKE 'trust_token%'`;
    expect(cols.map((c) => c.column_name)).toEqual(["trust_token_hash"]);

    const ok = await app.inject({
      method: "POST", url: "/v1/devices/step-up",
      headers: { ...auth(), "x-device-id": deviceId, "x-device-trust-token": trustToken },
    });
    expect(ok.statusCode).toBe(200);

    const stored = await app.inject({
      method: "POST", url: "/v1/devices/step-up",
      headers: { ...auth(), "x-device-id": deviceId, "x-device-trust-token": rows[0]!.trustTokenHash },
    });
    expect(stored.statusCode).toBe(403); // presenting the stored hash is not the token

    const wrong = await app.inject({
      method: "POST", url: "/v1/devices/step-up",
      headers: { ...auth(), "x-device-id": deviceId, "x-device-trust-token": `${trustToken.slice(0, -1)}${trustToken.endsWith("0") ? "1" : "0"}` },
    });
    expect(wrong.statusCode).toBe(403);
  });
});

describe("migration 0031_device_trust_token_hash (idempotent backfill)", () => {
  afterAll(async () => { await sqlClient.end(); });

  it("hashes legacy plaintext rows, drops trust_token, and re-runs as a no-op", async () => {
    const migration = readFileSync(join(__dirname, "../migrations/0031_device_trust_token_hash.sql"), "utf8");
    const legacyToken = randomUUID() + randomUUID();
    const deviceId = randomUUID();
    const ROLLBACK = new Error("rollback fq12 migration probe");
    let observed: { hash: string | null; columns: string[]; nullable: string; force: boolean; secondRunOk: boolean } | null = null;

    await sqlClient.begin(async (sql) => {
      // Recreate the pre-0031 shape inside this transaction only.
      await sql.unsafe(`ALTER TABLE devices.registered_devices ALTER COLUMN trust_token_hash DROP NOT NULL`);
      await sql.unsafe(`ALTER TABLE devices.registered_devices ADD COLUMN trust_token TEXT`);
      await sql`SELECT set_config('app.tenant_id', ${T}, true)`;
      await sql`
        INSERT INTO devices.registered_devices (id, tenant_id, user_id, platform, label, fingerprint, trust_token, trust_level, created_by, updated_by)
        VALUES (${deviceId}, ${T}, ${USER}, 'android', 'legacy', ${randomUUID()}, ${legacyToken}, 'recognized', ${USER}, ${USER})`;
      await sql`SELECT set_config('app.tenant_id', '', true)`;

      await sql.unsafe(migration);
      await sql.unsafe(migration); // second run must be a clean no-op

      await sql`SELECT set_config('app.tenant_id', ${T}, true)`;
      const [row] = await sql`SELECT trust_token_hash FROM devices.registered_devices WHERE id = ${deviceId}`;
      const cols = await sql`
        SELECT column_name, is_nullable FROM information_schema.columns
         WHERE table_schema = 'devices' AND table_name = 'registered_devices' AND column_name LIKE 'trust_token%'`;
      const [rel] = await sql`SELECT relforcerowsecurity FROM pg_class WHERE oid = 'devices.registered_devices'::regclass`;
      observed = {
        hash: (row?.trust_token_hash as string | undefined) ?? null,
        columns: cols.map((c) => c.column_name as string),
        nullable: String(cols[0]?.is_nullable),
        force: Boolean(rel?.relforcerowsecurity),
        secondRunOk: true,
      };
      throw ROLLBACK;
    }).catch((e) => { if (e !== ROLLBACK) throw e; });

    expect(observed).not.toBeNull();
    expect(observed!.hash).toBe(sha(legacyToken));
    expect(observed!.columns).toEqual(["trust_token_hash"]);
    expect(observed!.nullable).toBe("NO");
    expect(observed!.force).toBe(true); // FORCE RLS restored
    expect(observed!.secondRunOk).toBe(true);
  });
});
