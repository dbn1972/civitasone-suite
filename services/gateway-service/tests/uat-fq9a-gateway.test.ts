/**
 * UAT FQ9-A gateway defects (runner-fq9.md items #6, #15, #16 and the module-guard outage finding).
 *
 *  #15 bodyless DELETE: the proxy re-serialised the missing body as "{}" but sent no content-type, so
 *      fetch() labelled it text/plain and the upstream's z.object() body schema 400'd
 *      "Expected object, received string".
 *  #16 multipart uploads were 415'd at the gateway (no parser); a visitor-service device bearer
 *      (`device_...`) on the device heartbeat route was 401'd by the JWT edge check.
 *  #6  POST /api/v1/contract/documents/:id/extract went to contract-service (no such route) instead of
 *      legal-service, which serves it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { resolveRoute } from "../src/registry.js";
import { isDeviceAuthRoute, isDeviceBearer } from "../src/public-prefixes.js";

// HS256 test secret comes from vitest.config.ts env (JWT_SECRET), never a literal here.
const SECRET = process.env.JWT_SECRET as string;
const TOKEN = signToken({ sub: "actor-1", tid: "tenant-1", roles: ["admin"] }, SECRET, 3600);

let calls: Array<{ url: string; init: RequestInit | undefined }> = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("{}", { status: 202, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function upstreamCall(fragment: string) {
  return calls.find((c) => c.url.includes(fragment));
}

describe("#15 bodyless DELETE is forwarded as JSON", () => {
  it("labels the re-serialised empty body application/json (not text/plain)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/meetings/m-1/participants/p-1",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(202);
    const c = upstreamCall("/v1/meetings/m-1/participants/p-1");
    expect(c).toBeDefined();
    expect(c?.init?.body).toBe("{}");
    expect((c?.init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    await app.close();
  });

  it("still forwards a JSON body unchanged", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/meetings/m-1/participants",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(202);
    const c = upstreamCall("/v1/meetings/m-1/participants");
    expect(c?.init?.body).toBe(JSON.stringify({ name: "x" }));
    expect((c?.init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    await app.close();
  });
});

describe("#16 multipart passthrough", () => {
  it("forwards multipart/form-data raw with the client's boundary instead of 415", async () => {
    const app = await buildApp();
    const boundary = "----fq9aBoundary";
    const raw =
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n` +
      `Content-Type: image/png\r\n\r\n\x89PNG-bytes\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/visitor/scans/upload",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(raw, "latin1"),
    });
    expect(res.statusCode).not.toBe(415);
    expect(res.statusCode).toBe(202);
    const c = upstreamCall("/v1/visitor/scans/upload");
    expect(c).toBeDefined();
    expect(Buffer.isBuffer(c?.init?.body)).toBe(true);
    expect((c?.init?.body as Buffer).toString("latin1")).toBe(raw);
    expect((c?.init?.headers as Record<string, string>)["content-type"]).toBe(`multipart/form-data; boundary=${boundary}`);
    await app.close();
  });

  it("still requires a bearer for a multipart upload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/visitor/scans/upload",
      headers: { "content-type": "multipart/form-data; boundary=b" },
      payload: "--b--\r\n",
    });
    expect(res.statusCode).toBe(401);
    expect(calls.filter((c) => c.url.includes("/v1/visitor/"))).toHaveLength(0);
    await app.close();
  });
});

describe("#16 device bearer on the visitor device-auth route", () => {
  const DEVICE = "device_" + "A".repeat(64);

  it("forwards a device token on POST /api/v1/visitor/devices/heartbeat to visitor-service, without identity headers", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/visitor/devices/heartbeat",
      headers: {
        authorization: `Bearer ${DEVICE}`,
        "content-type": "application/json",
        "x-tenant-id": "11111111-2222-4000-8000-000000000001",
        "x-actor-id": "spoofed",
      },
      payload: { firmwareVersion: "1.0.0" },
    });
    expect(res.statusCode).toBe(202);
    const c = upstreamCall("/v1/visitor/devices/heartbeat");
    expect(c).toBeDefined();
    const h = c?.init?.headers as Record<string, string>;
    // visitor-service's deviceAuth authenticates this exact header.
    expect(h["authorization"]).toBe(`Bearer ${DEVICE}`);
    // No client-supplied identity crosses the edge on the device path.
    expect(h["x-tenant-id"]).toBeUndefined();
    expect(h["x-actor-id"]).toBeUndefined();
    await app.close();
  });

  it("does NOT open other routes to a device token (still 401 at the edge)", async () => {
    const app = await buildApp();
    for (const [method, url] of [
      ["GET", "/api/v1/visitor/devices"],
      ["POST", "/api/v1/visitor/devices"],
      ["GET", "/api/v1/visitor/devices/heartbeat"],
      ["POST", "/api/v1/visitor/devices/heartbeat/x"],
      ["POST", "/api/v1/visitor/scans/upload"],
      ["POST", "/api/v1/finance/journals"],
    ] as const) {
      calls = [];
      const res = await app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${DEVICE}`, "content-type": "application/json" },
        payload: method === "GET" ? undefined : {},
      });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(calls.filter((c) => !c.url.includes("/v1/admin/")), `${method} ${url}`).toHaveLength(0);
    }
    await app.close();
  });

  it("a non-device, non-JWT bearer on the heartbeat route is still rejected at the edge", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/visitor/devices/heartbeat",
      headers: { authorization: "Bearer not-a-jwt", "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("route / bearer predicates are exact", () => {
    expect(isDeviceAuthRoute("POST", "/api/v1/visitor/devices/heartbeat")).toBe(true);
    expect(isDeviceAuthRoute("post", "/api/v1/visitor/devices/heartbeat")).toBe(true);
    expect(isDeviceAuthRoute("POST", "/api/v1/visitor/devices/heartbeat/")).toBe(false);
    expect(isDeviceAuthRoute("PUT", "/api/v1/visitor/devices/heartbeat")).toBe(false);
    expect(isDeviceBearer(`Bearer ${DEVICE}`)).toBe(true);
    expect(isDeviceBearer(`Bearer ${TOKEN}`)).toBe(false);
    expect(isDeviceBearer(undefined)).toBe(false);
    expect(isDeviceBearer(DEVICE)).toBe(false);
  });
});

describe("#6 contract-document extraction is routed to legal-service", () => {
  it("resolves /api/v1/contract/documents/:id/extract to the legal upstream", () => {
    const r = resolveRoute("/api/v1/contract/documents/ce07dfea-6d3b-43b6-9b3c-68be33129e81/extract");
    expect(r?.route.name).toBe("contract-documents");
    expect(r?.route.upstream).toMatch(/:3021$/);
    expect(r?.route.upstreamPath).toBe("/v1/contract/documents");
  });

  it("keeps every other /api/v1/contract path on contract-service", () => {
    expect(resolveRoute("/api/v1/contract/contracts")?.route.name).toBe("contract");
    expect(resolveRoute("/api/v1/contract/documentsx")?.route.name).toBe("contract");
  });

  it("proxies the extract call to legal-service's /v1/contract/documents/:id/extract", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/contract/documents/d-1/extract",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    const c = upstreamCall("/v1/contract/documents/d-1/extract");
    expect(c?.url).toMatch(/^http:\/\/127\.0\.0\.1:3021\/v1\/contract\/documents\/d-1\/extract$/);
    await app.close();
  });
});
