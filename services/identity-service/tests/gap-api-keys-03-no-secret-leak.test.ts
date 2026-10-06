/**
 * GAP-IDENTITY-API-KEYS-03 — the admin API-keys LIST response must never carry
 * secret key material.
 *
 * The audit asked: does GET /identity/api-keys return only
 * id/name/keyPrefix/scopes/status/timestamps (and a stable id), and never a
 * field named key/secret/hash? If it did leak a secret, the web id-mapper's old
 * `row.key` fallback would have printed its first 8 chars into the ID column and
 * cached it offline — credential disclosure.
 *
 * These tests create a key (the ONE response that legitimately returns the
 * plaintext `key`, exactly once, on 202) and then assert the LIST never does:
 *   1. every listed row has a UUID `id`, a `keyPrefix`, and `scopes`,
 *   2. no listed row has any property matching /secret|hash/ or named `key`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-2222-4000-8000-0000000000a3";
const ACTOR = "a0000000-2222-4000-8000-0000000000a3";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function token(roles: string[] = ["tenant_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "5e551014-0000-4000-8000-00000000005e" } as never, SECRET);
}
const headers = (roles?: string[]) => ({ authorization: `Bearer ${token(roles)}` });

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });

describe("GAP-IDENTITY-API-KEYS-03 — list never leaks secret material", () => {
  it("create returns the plaintext key exactly once (202) — the only place it may appear", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/api-keys",
      headers: headers(["tenant_admin"]),
      payload: { name: "gap-api-keys-03", scopes: ["users:read"] },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.key).toBeDefined(); // plaintext, once
    expect(body.keyPrefix).toBeDefined();
  });

  it("GET /identity/api-keys returns rows with a UUID id, keyPrefix and scopes, and NO secret/hash/key field", async () => {
    const res = await app.inject({
      method: "GET", url: "/identity/api-keys",
      headers: headers(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);

    for (const row of rows) {
      // stable UUID id (the web mapper shows this; it must never be a secret)
      expect(typeof row.id).toBe("string");
      expect(UUID_RE.test(row.id as string)).toBe(true);
      expect(typeof row.keyPrefix).toBe("string");
      expect(Array.isArray(row.scopes)).toBe(true);

      // No property whose NAME is a secret, and no `key` field at all.
      for (const prop of Object.keys(row)) {
        expect(prop).not.toBe("key");
        expect(prop).not.toBe("secret");
        expect(/secret|hash/i.test(prop)).toBe(false);
      }
    }
  });

  it("the whole serialized list body contains no 'secretHash'/'fullKey' plumbing", async () => {
    const res = await app.inject({
      method: "GET", url: "/identity/api-keys",
      headers: headers(["tenant_admin"]),
    });
    const raw = res.body;
    expect(raw).not.toMatch(/secretHash/);
    expect(raw).not.toMatch(/fullKey/);
    expect(raw).not.toMatch(/"secret"/);
  });
});
