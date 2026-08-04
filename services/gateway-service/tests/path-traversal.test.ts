/**
 * Encoded-traversal auth bypass at the gateway edge.
 *
 * The bug: `isPublic` and `resolveRoute` both read the RAW, un-normalised
 * `req.url.split("?")[0]`, while `fetch()` hands the target to the WHATWG URL parser,
 * which collapses `%2e%2e` into a real `..` segment. So
 *
 *     POST /api/v1/crm/public/%2e%2e/contacts
 *
 * passed the public-prefix check (skipping the bearer check AND `jwtEdgeVerify`) and then
 * arrived upstream as `/v1/crm/contacts` — an anonymous caller on an authenticated route.
 *
 * ── Why these tests use a RAW SOCKET, not app.inject ────────────────────────────
 * `app.inject` (light-my-request) builds the request through a WHATWG URL, so it
 * normalises `%2e%2e` to `..` and collapses it BEFORE Fastify ever sees the path. An
 * injected request therefore cannot reproduce the attack: the harness silently fixes it.
 * Node's HTTP server does no such thing — `req.url` is the bytes off the wire, which is
 * exactly the condition the bug lives in. So the traversal cases speak HTTP/1.1 down a
 * socket to a real listener.
 *
 * The two things these tests hold down:
 *   1. every traversal spelling is refused with 400 at the edge and NOTHING is proxied;
 *   2. a path that merely LOOKS like the public prefix (`publicXYZ`) stays an ordinary
 *      authenticated route — a guard that 400s legitimate traffic is its own outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { canonicalisePath } from "../src/path-guard.js";

const SECRET = "test_secret_for_civitasone_32chr";
const VALID_TOKEN = signToken({ sub: "actor-1", tid: "tenant-1", roles: ["admin"] }, SECRET, 3600);

/** Every URL an upstream fetch was attempted for. Must stay empty for a rejected path. */
let upstreamCalls: string[] = [];

beforeEach(() => {
  upstreamCalls = [];
  vi.stubGlobal("fetch", async (url: string) => {
    upstreamCalls.push(String(url));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface RawResponse {
  status: number;
  body: string;
}

/**
 * Send a request whose path is transmitted BYTE FOR BYTE, with no URL parsing in between.
 * This is the only way to exercise the code path the bypass lived on.
 */
async function rawRequest(
  method: string,
  rawPath: string,
  opts: { authorization?: string; body?: string } = {},
): Promise<RawResponse> {
  const app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as AddressInfo).port;
  const body = opts.body ?? "{}";
  try {
    return await new Promise<RawResponse>((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.write(
          [
            `${method} ${rawPath} HTTP/1.1`,
            `Host: 127.0.0.1:${port}`,
            "Content-Type: application/json",
            `Content-Length: ${Buffer.byteLength(body)}`,
            ...(opts.authorization !== undefined ? [`Authorization: ${opts.authorization}`] : []),
            "Connection: close",
            "",
            body,
          ].join("\r\n"),
        );
      });
      let raw = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => { raw += chunk; });
      socket.on("error", reject);
      socket.on("end", () => {
        // "HTTP/1.1 400 Bad Request" → the status is at a fixed offset.
        resolve({ status: Number(raw.slice(9, 12)), body: raw.slice(raw.indexOf("\r\n\r\n") + 4) });
      });
    });
  } finally {
    await app.close();
  }
}

describe("gateway path guard — encoded traversal out of the public prefix", () => {
  // Each of these resolves to /v1/crm/contacts once a dot-segment-aware parser sees it.
  const TRAVERSALS: Array<[string, string]> = [
    ["lowercase percent-encoded dots", "/api/v1/crm/public/%2e%2e/contacts"],
    ["UPPERCASE percent-encoded dots", "/api/v1/crm/public/%2E%2E/contacts"],
    ["mixed-case percent-encoded dots", "/api/v1/crm/public/%2e%2E/contacts"],
    ["literal dot-dot segment", "/api/v1/crm/public/../contacts"],
    ["single-dot segment", "/api/v1/crm/public/./leads"],
    ["double-encoded dots", "/api/v1/crm/public/%252e%252e/contacts"],
    ["encoded slash manufacturing a segment", "/api/v1/crm/public%2f%2e%2e/contacts"],
    ["backslash separator", "/api/v1/crm/public\\..\\contacts"],
    ["interior double slash", "/api/v1/crm/public//../contacts"],
    ["traversal with a query string attached", "/api/v1/crm/public/%2e%2e/contacts?limit=50"],
  ];

  it.each(TRAVERSALS)("rejects %s with 400 and proxies nothing", async (_label, rawPath) => {
    const res = await rawRequest("POST", rawPath, { body: JSON.stringify({ name: "Attacker" }) });

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).code).toBe("BAD_REQUEST");
    // The decisive assertion: a 400 that still forwarded the request would be cosmetic.
    expect(upstreamCalls).toEqual([]);
  });

  it("does not leak which check tripped, or echo the offending path", async () => {
    const res = await rawRequest("POST", "/api/v1/crm/public/%2e%2e/contacts");
    expect(res.body).not.toMatch(/dot_segment|%2e|traversal|\.\./i);
  });

  it("treats a bare interior double slash as malformed on an authenticated route too", async () => {
    // The guard is not scoped to the public prefix: "//" is a normalisation hazard wherever
    // it appears, and no legitimate client sends it.
    const res = await rawRequest("GET", "/api/v1/finance//bills");
    expect(res.status).toBe(400);
    expect(upstreamCalls).toEqual([]);
  });

  it("rejects a traversal even when a valid bearer token IS presented", async () => {
    // The guard is about the request being well-formed, not about who is asking.
    const res = await rawRequest("GET", "/api/v1/finance/%2e%2e/identity/users", {
      authorization: `Bearer ${VALID_TOKEN}`,
    });
    expect(res.status).toBe(400);
    expect(upstreamCalls).toEqual([]);
  });
});

describe("gateway path guard — legitimate paths are untouched", () => {
  it("keeps `publicXYZ` an ordinary AUTHENTICATED route — 401, never 400", async () => {
    // A prefix check written as `startsWith(p)` without the trailing slash would make this
    // public; a guard that rejected it would take out a real route. Neither is acceptable.
    for (const rawPath of [
      "/api/v1/crm/publicXYZ",
      "/api/v1/crm/publicXYZ/leads",
      "/api/v1/crm/public-forms",
    ]) {
      const res = await rawRequest("POST", rawPath);
      expect(res.status, rawPath).toBe(401);
    }
    expect(upstreamCalls).toEqual([]);
  });

  it("still lets the genuine public lead-capture path through unauthenticated", async () => {
    const res = await rawRequest("POST", `/api/v1/crm/public/leads/${"a".repeat(64)}`, {
      body: JSON.stringify({ name: "Jane Prospect", consent: true }),
    });
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(401);
    expect(upstreamCalls.some((u) => u.includes("/v1/crm/public/leads/"))).toBe(true);
  });

  it("forwards the client's own path bytes rather than a decoded rewrite", async () => {
    // A decoded `%23` would be read as a fragment by fetch() and silently truncate the
    // path, so what an upstream authorises must be what the client actually sent.
    await rawRequest("GET", "/api/v1/finance/bills/INV%232026", {
      authorization: `Bearer ${VALID_TOKEN}`,
    });
    // `.some`, not `[0]`: the module-guard and quota plugins make their own upstream calls
    // before the proxy fetch, so position is not stable.
    expect(upstreamCalls.some((u) => u.includes("INV%232026"))).toBe(true);
  });

  it("preserves the query string and a trailing slash", async () => {
    await rawRequest("GET", "/api/v1/finance/bills/?limit=50", {
      authorization: `Bearer ${VALID_TOKEN}`,
    });
    expect(upstreamCalls.some((u) => u.includes("/bills/?limit=50"))).toBe(true);
  });
});

describe("canonicalisePath", () => {
  it("accepts ordinary paths and returns the decoded form", () => {
    expect(canonicalisePath("/api/v1/crm/contacts")).toEqual({
      ok: true,
      pathname: "/api/v1/crm/contacts",
    });
    expect(canonicalisePath("/api/v1/crm/contacts?x=1&y=2")).toEqual({
      ok: true,
      pathname: "/api/v1/crm/contacts",
    });
    // A dot INSIDE a segment is not a dot SEGMENT — only whole "." / ".." are traversal.
    expect(canonicalisePath("/api/v1/reports/summary.pdf")).toEqual({
      ok: true,
      pathname: "/api/v1/reports/summary.pdf",
    });
  });

  it.each([
    ["/api/v1/crm/public/%2e%2e/x", "dot_segment"],
    ["/api/v1/crm/public/%2E%2E/x", "dot_segment"],
    ["/api/v1/crm/public/../x", "dot_segment"],
    ["/api/v1/crm/public/./x", "dot_segment"],
    ["/api/v1/crm/public/%252e%252e/x", "dot_segment"],
    ["/api/v1/crm/public//x", "empty_segment"],
    ["/api/v1/crm/public\\x", "backslash_segment"],
    ["/api/v1/crm/public%2fx", "encoded_slash"],
    // A stray "%" makes decodeURIComponent throw; Node forwarded it verbatim while the URL
    // parser would treat it differently again, which is the divergence we refuse.
    ["/api/v1/crm/public/%zz", "malformed_encoding"],
    ["/api/v1/crm/public/%", "malformed_encoding"],
  ])("rejects %s as %s", (url, reason) => {
    expect(canonicalisePath(url)).toEqual({ ok: false, reason });
  });

  it("allows a leading and a trailing slash, and the root path", () => {
    expect(canonicalisePath("/")).toEqual({ ok: true, pathname: "/" });
    expect(canonicalisePath("/api/v1/crm/contacts/")).toEqual({
      ok: true,
      pathname: "/api/v1/crm/contacts/",
    });
  });

  it("keeps `publicXYZ` acceptable — the guard must not swallow real routes", () => {
    expect(canonicalisePath("/api/v1/crm/publicXYZ/leads")).toEqual({
      ok: true,
      pathname: "/api/v1/crm/publicXYZ/leads",
    });
  });
});
