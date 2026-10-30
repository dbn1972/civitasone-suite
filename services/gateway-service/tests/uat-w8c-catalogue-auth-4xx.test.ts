/**
 * UAT W8-C (live API sweep) — gateway-native API catalogue (/api/v1/gateway/catalogue).
 *
 * 1. Every catalogue route answered 401 "invalid or expired token" to every real (Keycloak RS256) user
 *    token: resolveContext() only called resolveServiceContext(), whose bearer path is the HS256
 *    dev/test shared secret, and the gateway registers no authPlugin to populate req.ctx. It now uses
 *    the token jwtEdgeVerify already verified (req.jwtPayload), else verifies the bearer itself with
 *    verifyJwt (RS256/JWKS), exactly like authPlugin does in every other service.
 *    This suite reproduces the UAT state: no JWT_SECRET (so no HS256 path) and an RS256 verifier.
 * 2. A malformed JSON body answered 500: the catalogue's own error handler mapped the JSON parser's
 *    SyntaxError (statusCode 400) to "internal error". It now answers 400.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateKeyPairSync, createSign, createVerify, randomUUID, type KeyObject } from "node:crypto";
import type { FastifyInstance } from "fastify";

const TENANT = "8c000000-0000-4000-8000-0000000009a1";
const ACTOR = "8c000000-0000-4000-8000-0000000009c3";

const realm = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");
function rs256(payload: Record<string, unknown>, key: KeyObject = realm.privateKey): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "w8c" }));
  const body = b64url(JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...payload }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key);
  return `${head}.${body}.${b64url(sig)}`;
}

// Stand-in for the Keycloak JWKS verification: RS256 against the realm public key, nothing else.
vi.mock("@civitasone/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@civitasone/auth")>();
  return {
    ...orig,
    verifyJwt: async (token: string) => {
      const [h, p, s] = token.split(".");
      if (!h || !p || !s) throw new Error("Invalid JWT structure");
      const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(realm.publicKey, Buffer.from(s, "base64url"));
      if (!ok) throw new Error("invalid signature");
      const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
      if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) throw new Error("jwt expired");
      return payload;
    },
  };
});

vi.mock("../src/shared/infra.js", async () => {
  const { MemoryQueue } = await import("@civitasone/queue");
  const { Cache } = await import("@civitasone/cache");
  return { queue: new MemoryQueue(), cache: new Cache({ service: "gateway", defaultTtlSeconds: 60 }) };
});

const admin = () => ({ authorization: `Bearer ${rs256({ sub: ACTOR, tid: TENANT, roles: ["platform_admin"] })}` });

let app: FastifyInstance;
let applyConfig: (typeof import("../src/runtime-config.js"))["applyConfig"];
const savedSecret = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.QUEUE_DRIVER = process.env.QUEUE_DRIVER ?? "memory";
  ({ applyConfig } = await import("../src/runtime-config.js"));
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
  // UAT runs RS256 only: no shared HS256 secret for resolveServiceContext to fall back on.
  delete process.env.JWT_SECRET;
});

afterAll(async () => {
  if (savedSecret !== undefined) process.env.JWT_SECRET = savedSecret;
  applyConfig({ jwtEdgeVerify: "true" });
  if (app) await app.close();
});

describe("catalogue auth with a real RS256 token (no HS256 secret)", () => {
  for (const mode of ["true", "off"] as const) {
    describe(`GATEWAY_JWT_EDGE_VERIFY=${mode}`, () => {
      beforeAll(() => { applyConfig({ jwtEdgeVerify: mode }); });

      it("GET list -> 200 (was 401 invalid or expired token)", async () => {
        const res = await app.inject({ method: "GET", url: "/api/v1/gateway/catalogue", headers: admin() });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.json().data)).toBe(true);
      });
      it("GET a missing id -> 404 (was 401)", async () => {
        const res = await app.inject({ method: "GET", url: `/api/v1/gateway/catalogue/${randomUUID()}`, headers: admin() });
        expect(res.statusCode).toBe(404);
      });
      it("bad query -> 400", async () => {
        const res = await app.inject({ method: "GET", url: "/api/v1/gateway/catalogue?status=bogus", headers: admin() });
        expect(res.statusCode).toBe(400);
      });
      it("a token signed with another key is still refused (401)", async () => {
        const forged = rs256({ sub: ACTOR, tid: TENANT, roles: ["platform_admin"] }, attacker.privateKey);
        const res = await app.inject({ method: "GET", url: "/api/v1/gateway/catalogue", headers: { authorization: `Bearer ${forged}` } });
        expect(res.statusCode).toBe(401);
      });
      it("a verified token without the admin role is 403", async () => {
        const t = rs256({ sub: ACTOR, tid: TENANT, roles: ["finance_officer"] });
        const res = await app.inject({ method: "GET", url: "/api/v1/gateway/catalogue", headers: { authorization: `Bearer ${t}` } });
        expect(res.statusCode).toBe(403);
      });
      it("no token -> 401", async () => {
        const res = await app.inject({ method: "GET", url: "/api/v1/gateway/catalogue" });
        expect(res.statusCode).toBe(401);
      });
    });
  }
});

describe("malformed JSON body -> 400, not 500 INTERNAL", () => {
  beforeAll(() => { applyConfig({ jwtEdgeVerify: "true" }); });
  const id = randomUUID();
  for (const url of ["/api/v1/gateway/catalogue", `/api/v1/gateway/catalogue/${id}/deprecate`, `/api/v1/gateway/catalogue/${id}/lifecycle`, "/api/v1/gateway/catalogue/seed"]) {
    it(`POST ${url.replace(id, ":id")}`, async () => {
      const res = await app.inject({ method: "POST", url, headers: { ...admin(), "content-type": "application/json" }, payload: "{not json" });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("MALFORMED_BODY");
    });
  }
});
