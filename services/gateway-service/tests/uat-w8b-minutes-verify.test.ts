/**
 * UAT W8-B (untriaged row): POST /api/v1/meetings/minutes/verify was 401'd at the gateway although
 * meeting-service declares it `config:{public:true}` (Req 8.4 public signature verification of
 * signed minutes: zod-validated `{minutesId | hashCurrent}` + optional `?tenantId=` uuid, answers
 * only `{found, integrity, signed}`). Called straight on meeting-service it answered 200 anonymously;
 * through the gateway it answered 401 UNAUTHENTICATED. Same defect family as UAT W6-G (fire / shop /
 * trade verify). It is now an exact (POST, path) PUBLIC_ROUTES entry: nothing else opens up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { isPublicRoute } from "../src/public-prefixes.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aaaaaaaa-1111-4000-8000-0000000008b0";
const ACTOR = "cccccccc-3333-4000-8000-0000000008b0";
const PATH = "/api/v1/meetings/minutes/verify";
const UPSTREAM = `http://127.0.0.1:3033/v1/meetings/minutes/verify?tenantId=${TENANT}`;
const BODY = { minutesId: "dddddddd-4444-4000-8000-0000000008b0" };

let calls: Array<{ url: string; init: RequestInit | undefined }> = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: { found: false, integrity: "not_found", signed: false } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UAT W8-B: anonymous minutes signature verification", () => {
  it("only the exact POST path is public", () => {
    expect(isPublicRoute("POST", PATH)).toBe(true);
    expect(isPublicRoute("post", PATH)).toBe(true);
    expect(isPublicRoute("GET", PATH)).toBe(false);
    expect(isPublicRoute("POST", `${PATH}/`)).toBe(false);
    expect(isPublicRoute("POST", "/api/v1/meetings/minutes")).toBe(false);
  });

  it("anonymous POST reaches meeting-service's verify route with the body intact", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `${PATH}?tenantId=${TENANT}`, payload: BODY });
    expect(res.statusCode).toBe(200);
    const c = calls.find((x) => x.url === UPSTREAM);
    expect(c, calls.map((x) => x.url).join(", ")).toBeDefined();
    expect(c?.init?.method).toBe("POST");
    expect(JSON.parse(String(c?.init?.body))).toEqual(BODY);
    await app.close();
  });

  it("forwards no client-supplied identity, and a stale bearer does not 401 it", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `${PATH}?tenantId=${TENANT}`, payload: BODY,
      headers: { authorization: "Bearer not-a-jwt", "x-tenant-id": TENANT, "x-actor-id": ACTOR },
    });
    expect(res.statusCode).toBe(200);
    const h = calls.find((x) => x.url === UPSTREAM)?.init?.headers as Record<string, string>;
    expect(h["x-tenant-id"]).toBeUndefined();
    expect(h["x-actor-id"]).toBeUndefined();
    expect(h["authorization"]).toBeUndefined();
    await app.close();
  });

  it("every other method on the path still requires a token", async () => {
    const app = await buildApp();
    for (const method of ["GET", "PUT", "PATCH", "DELETE"] as const) {
      const res = await app.inject({ method, url: PATH, payload: method === "GET" ? undefined : BODY });
      expect(res.statusCode, method).toBe(401);
    }
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("path variants and sibling meeting routes still require a token", async () => {
    const app = await buildApp();
    for (const url of [
      `${PATH}/`,
      `${PATH}/x`,
      `${PATH}x`,
      "/api/v1/meetings/minutes/VERIFY",
      "/api/v1/meetings/minutes",
      "/api/v1/meetings/dddddddd-4444-4000-8000-0000000008b0/minutes",
      "/api/v1/meetings/config",
    ]) {
      const res = await app.inject({ method: "POST", url, payload: BODY });
      expect(res.statusCode, url).toBe(401);
    }
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("an authenticated caller still gets through with its verified identity", async () => {
    const app = await buildApp();
    const tok = signToken({ sub: ACTOR, tid: TENANT, roles: ["employee"], sid: "s-w8b" }, SECRET, 3600);
    const res = await app.inject({ method: "POST", url: `${PATH}?tenantId=${TENANT}`, payload: BODY, headers: { authorization: `Bearer ${tok}` } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
