/**
 * Q41 contract: the officer workbasket posts to
 *   /api/proxy/v1/citizen/documents/verification-lane/batch
 * (apps/web workflow/_components/DocVerificationChecklist.tsx). The web BFF proxy
 * strips `/proxy`, so the gateway sees `/api/v1/citizen/documents/verification-lane/batch`.
 * This pins, end to end through the gateway, that
 *   - the registry resolves it to citizen-service at the path the service registers,
 *   - it is NOT a public path (no token -> 401, nothing forwarded),
 *   - an authenticated POST is forwarded upstream as a POST with its body intact,
 *   - the sibling GET alias resolves the same way.
 * so a registry or allow-list refactor cannot silently break the officer inbox.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { resolveRoute } from "../src/registry.js";
import { PUBLIC_PREFIXES } from "../src/public-prefixes.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TOKEN = signToken({ sub: "actor-1", tid: "tenant-1", roles: ["workflow_officer"] }, SECRET, 3600);
const GATEWAY_PATH = "/api/v1/citizen/documents/verification-lane/batch";
const SERVICE_PATH = "/v1/citizen/documents/verification-lane/batch";
const BODY = { lanes: [{ laneKey: "inspection", serviceId: "11111111-1111-4111-8111-111111111111" }] };

let calls: Array<{ url: string; method: string; body: string | undefined }> = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method ?? "GET"), body: typeof init?.body === "string" ? init.body : undefined });
    // Serves both the admin-service module-entitlement lookup (data[].name) and the upstream itself.
    return new Response(JSON.stringify({ data: [{ name: "citizen" }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("gateway route: POST /v1/citizen/documents/verification-lane/batch", () => {
  it.each([GATEWAY_PATH, "/api/v1/citizen/documents/verification-lane"])("%s resolves to citizen-service at the registered path", (path) => {
    const resolved = resolveRoute(path);
    expect(resolved).not.toBeNull();
    expect(resolved!.route.name).toBe("citizen");
    expect(resolved!.route.upstreamPath).toBeUndefined(); // default: prefix without /api
    expect(path.replace(/^\/api/, "")).toBe("/v1/citizen" + resolved!.remainder);
  });

  it("is not on the public allow-list (officer-only data must never be anonymous)", () => {
    expect(PUBLIC_PREFIXES.some((p) => GATEWAY_PATH === p || GATEWAY_PATH.startsWith(`${p}/`))).toBe(false);
  });

  it("rejects an unauthenticated POST with 401 and forwards nothing", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: GATEWAY_PATH, payload: BODY });
    expect(res.statusCode).toBe(401);
    expect(calls.filter((c) => new URL(c.url).pathname === SERVICE_PATH)).toEqual([]);
    await app.close();
  });

  it("forwards an authenticated POST to citizen-service with the method and body intact", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: GATEWAY_PATH, headers: { authorization: `Bearer ${TOKEN}` }, payload: BODY });
    expect(res.statusCode).toBe(200);
    const upstream = calls.filter((c) => new URL(c.url).pathname === SERVICE_PATH);
    expect(upstream).toHaveLength(1);
    expect(upstream[0]!.method).toBe("POST");
    expect(JSON.parse(upstream[0]!.body ?? "null")).toEqual(BODY);
    await app.close();
  });
});
