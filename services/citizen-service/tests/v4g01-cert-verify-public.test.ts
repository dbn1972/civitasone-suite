/**
 * V4-G-01: public certificate QR verification must work for an ANONYMOUS caller against the
 * FORCE-RLS issuance.certificates table, without weakening tenant isolation for anything else.
 * Real-DB test (runs as the non-superuser service role named by DATABASE_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { resolveClientIp } from "../src/modules/issuance/domain.js";
import type { FastifyInstance } from "fastify";

const uuid = () => globalThis.crypto.randomUUID();
const TENANT_A = uuid();
const TENANT_B = uuid();
const ACTOR = uuid();
const tokenA = `tokA_${uuid().replace(/-/g, "")}`;
const tokenB = `tokB_${uuid().replace(/-/g, "")}`;
const tokenRevoked = `tokR_${uuid().replace(/-/g, "")}`;
let app: FastifyInstance;

async function seed(tenant: string, token: string, status: string, certNo: string) {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    await tx`INSERT INTO issuance.certificates
      (tenant_id, cert_type, cert_no, status, subject, payload, payload_hash, signature, verify_token,
       valid_from, valid_to, requested_by, created_by, updated_by, issued_at)
      VALUES (${tenant}, 'INCOME', ${certNo}, ${status}, '{"name":"Secret Citizen"}'::jsonb,
              '{"aadhaar":"pii"}'::jsonb, 'hash-1', 'sig-1', ${token},
              '2020-01-01', '2999-01-01', ${ACTOR}, ${ACTOR}, ${ACTOR}, now())`;
  });
}

beforeAll(async () => {
  app = await buildApp();
  await seed(TENANT_A, tokenA, "active", `CERT-A-${tokenA.slice(-6)}`);
  await seed(TENANT_B, tokenB, "active", `CERT-B-${tokenB.slice(-6)}`);
  await seed(TENANT_A, tokenRevoked, "revoked", `CERT-R-${tokenRevoked.slice(-6)}`);
});

afterAll(async () => {
  await sqlClient.begin(async (tx) => {
    for (const t of [TENANT_A, TENANT_B]) {
      await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
      await tx`DELETE FROM issuance.certificates WHERE tenant_id = ${t}`;
    }
  });
  await app.close();
  await sqlClient.end();
});

const verify = (token: string) => app.inject({ method: "GET", url: `/v1/citizen/certificates/verify/${token}` });

describe("V4-G-01 public certificate verification", () => {
  it("anonymous caller verifies a valid certificate of any tenant by token (non-PII fields only)", async () => {
    for (const [token, no] of [[tokenA, "CERT-A-"], [tokenB, "CERT-B-"]] as const) {
      const res = await verify(token);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.found).toBe(true);
      expect(body.validity).toBe("valid");
      expect(body.certNo).toContain(no);
      expect(body.payloadHash).toBe("hash-1");
      expect(Object.keys(body).sort()).toEqual(
        ["certNo", "certType", "found", "issuedAt", "payloadHash", "signature", "status", "validFrom", "validTo", "validity"],
      );
      expect(JSON.stringify(body)).not.toMatch(/Secret Citizen|aadhaar/);
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });

  it("a revoked certificate reports invalid; unknown/odd tokens are 404, too-short is 400", async () => {
    const revoked = await verify(tokenRevoked);
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().validity).toBe("invalid");
    expect((await verify("tokUnknown_does_not_exist")).statusCode).toBe(404);
    expect((await verify("short")).statusCode).toBe(400); // fails tokenParam (min 8) before any DB access
    expect((await verify("bad%27%20OR%201%3D1--aaaaaaaa")).statusCode).toBe(404);
  });
});

describe("V4-G-01 tenant isolation is not weakened", () => {
  const count = (q: (tx: typeof sqlClient) => Promise<unknown[]>) => sqlClient.begin(async (tx) => (await q(tx as never)).length);

  it("with no GUC, no certificate is visible; a token GUC exposes exactly one row", async () => {
    expect(await count((tx) => tx`SELECT id FROM issuance.certificates`)).toBe(0);
    const one = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.cert_verify_token', ${tokenA}, true)`;
      return tx`SELECT verify_token FROM issuance.certificates`;
    });
    expect(one).toHaveLength(1);
    expect(one[0]!.verify_token).toBe(tokenA);
    const none = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.cert_verify_token', '', true)`;
      return tx`SELECT id FROM issuance.certificates`;
    });
    expect(none).toHaveLength(0);
  });

  it("the token GUC grants no write access", async () => {
    const res = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.cert_verify_token', ${tokenA}, true)`;
      const upd = await tx`UPDATE issuance.certificates SET status = 'revoked' WHERE verify_token = ${tokenA}`;
      const del = await tx`DELETE FROM issuance.certificates WHERE verify_token = ${tokenA}`;
      return [upd.count, del.count];
    });
    expect(res).toEqual([0, 0]);
    expect((await verify(tokenA)).json().status).toBe("active");
  });

  it("the tenant GUC still isolates tenants (the token policy does not widen it)", async () => {
    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      return tx`SELECT tenant_id FROM issuance.certificates`;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
  });

  it("migration adds only a SELECT policy and leaves FORCE RLS alone", () => {
    const sql = readFileSync(new URL("../migrations/0044_certificate_public_verify_policy.sql", import.meta.url), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sql).toMatch(/CREATE POLICY public_verify_read[\s\S]*FOR SELECT/);
    expect(sql).not.toMatch(/FOR (ALL|INSERT|UPDATE|DELETE)|NO FORCE|DISABLE ROW|BYPASSRLS/i);
  });

  describe("per-client rate limit behind the gateway", () => {
    const prev = process.env.TRUSTED_PROXY_HOPS;
    beforeAll(() => { process.env.TRUSTED_PROXY_HOPS = "1"; });
    afterAll(() => { if (prev === undefined) delete process.env.TRUSTED_PROXY_HOPS; else process.env.TRUSTED_PROXY_HOPS = prev; });
    // remoteAddress = gateway peer (127.0.0.1 is on the limiter allowList)
    const from = (xff: string) => app.inject({
      method: "GET", url: `/v1/citizen/certificates/verify/${tokenA}`, remoteAddress: "172.16.0.5", headers: { "x-forwarded-for": xff },
    });
    const octet = () => 1 + Math.floor(Math.random() * 250);
    const ip = () => `10.${octet()}.${octet()}.${octet()}`;

    it("gives each forwarded client its own budget and ignores a spoofed leading entry", async () => {
      const a = ip(), b = ip();
      for (let i = 0; i < 30; i++) expect((await from(a)).statusCode).toBe(200);
      expect((await from(a)).statusCode).toBe(429);
      expect((await from(b)).statusCode).toBe(200);
      // a spoofed leading entry does not mint a fresh bucket: the trusted (last) entry is still `a`
      expect((await from(`${ip()}, ${a}`)).statusCode).toBe(429);
    });

    it("resolveClientIp: last-hop only, fail closed on short chain, ignored at hops=0", () => {
      const req = (xff: string | undefined) => ({ ip: "172.0.0.9", headers: xff === undefined ? {} : { "x-forwarded-for": xff } });
      expect(resolveClientIp(req("9.9.9.9, 10.1.1.1"))).toBe("10.1.1.1");
      expect(resolveClientIp(req(undefined))).toBe("172.0.0.9");
      process.env.TRUSTED_PROXY_HOPS = "2";
      expect(resolveClientIp(req("6.6.6.6"))).toBe("172.0.0.9");
      process.env.TRUSTED_PROXY_HOPS = "0";
      expect(resolveClientIp(req("6.6.6.6"))).toBe("172.0.0.9");
      process.env.TRUSTED_PROXY_HOPS = "1";
    });
  });
});
