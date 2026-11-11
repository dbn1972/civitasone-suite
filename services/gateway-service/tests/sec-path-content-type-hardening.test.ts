/**
 * Gateway edge hardening: parser-differential paths (`;`, `%25`, `%00`, control chars, long
 * paths) are refused with 400, and body methods are limited to an explicit content-type
 * allow-list (415). Query strings are never affected.
 *
 * Paths and headers are sent over a RAW socket: app.inject builds the request through a WHATWG
 * URL, which would normalise or reject exactly the bytes under test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.js";
import { canonicalisePath, MAX_PATH_LENGTH } from "../src/path-guard.js";
import { checkBodyContentType } from "../src/content-type-guard.js";

let upstreamCalls: string[] = [];
beforeEach(() => {
  upstreamCalls = [];
  vi.stubGlobal("fetch", async (url: string) => {
    upstreamCalls.push(String(url));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

async function raw(
  method: string,
  rawPath: string,
  opts: { contentType?: string | null; body?: string } = {},
): Promise<{ status: number; body: string }> {
  const app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as AddressInfo).port;
  const body = opts.body ?? "{}";
  const ct = opts.contentType === undefined ? "application/json" : opts.contentType;
  try {
    return await new Promise((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.write(
          [
            `${method} ${rawPath} HTTP/1.1`,
            `Host: 127.0.0.1:${port}`,
            ...(ct === null ? [] : [`Content-Type: ${ct}`]),
            `Content-Length: ${Buffer.byteLength(body)}`,
            "Connection: close",
            "",
            body,
          ].join("\r\n"),
        );
      });
      let out = "";
      socket.setEncoding("utf8");
      socket.on("data", (c) => { out += c; });
      socket.on("error", reject);
      socket.on("end", () => resolve({ status: Number(out.slice(9, 12)), body: out.slice(out.indexOf("\r\n\r\n") + 4) }));
    });
  } finally {
    await app.close();
  }
}

describe("path guard: parser-differential rejections", () => {
  const BAD: Array<[string, string, string]> = [
    ["semicolon-dotdot", "/api/v1/crm/public/..;/contacts", "semicolon"],
    ["plain semicolon", "/api/v1/crm/public/x;y", "semicolon"],
    ["semicolon on authenticated route", "/api/v1/finance/bills;jsessionid=1", "semicolon"],
    ["double-encoded slash", "/api/v1/crm/public%252fx", "double_encoding"],
    ["double-encoded percent", "/api/v1/crm/public/a%25b", "double_encoding"],
    ["encoded NUL", "/api/v1/crm/public/a%00b", "null_byte"],
    ["encoded TAB", "/api/v1/crm/public/a%09b", "control_char"],
    ["encoded CR", "/api/v1/crm/public/a%0db", "control_char"],
    ["encoded LF", "/api/v1/crm/public/a%0Ab", "control_char"],
    ["encoded ESC", "/api/v1/crm/public/a%1bb", "control_char"],
    ["encoded DEL", "/api/v1/crm/public/a%7fb", "control_char"],
    ["over-long path", "/api/v1/crm/public/" + "a".repeat(MAX_PATH_LENGTH), "path_too_long"],
  ];

  it.each(BAD)("canonicalisePath rejects %s", (_l, path, reason) => {
    expect(canonicalisePath(path)).toEqual({ ok: false, reason });
  });

  it("rejects a raw control character and a raw DEL", () => {
    expect(canonicalisePath("/api/v1/a\tb")).toEqual({ ok: false, reason: "control_char" });
    expect(canonicalisePath("/api/v1/a\x01b")).toEqual({ ok: false, reason: "control_char" });
    expect(canonicalisePath("/api/v1/a\x7fb")).toEqual({ ok: false, reason: "control_char" });
  });

  it("accepts a path of exactly the maximum length", () => {
    const p = "/" + "a".repeat(MAX_PATH_LENGTH - 1);
    expect(p.length).toBe(MAX_PATH_LENGTH);
    expect(canonicalisePath(p).ok).toBe(true);
  });

  it.each(BAD)("edge answers 400 and proxies nothing for %s", async (_l, path) => {
    const res = await raw("POST", path);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).code).toBe("BAD_REQUEST");
    expect(upstreamCalls).toEqual([]);
  });

  it("still allows an encoded semicolon (%3B) in a segment", () => {
    expect(canonicalisePath("/api/v1/hrms/leave%3Bx/apply")).toEqual({ ok: true, pathname: "/api/v1/hrms/leave;x/apply" });
  });

  it("never inspects the query string: %25, ';', long values and encoded controls all pass", () => {
    const long = "v".repeat(5000);
    for (const q of ["?q=100%25", "?a=b;c=d", `?q=${long}`, "?q=a%25b%252f", "?x=%09", "?x=%00"]) {
      expect(canonicalisePath("/api/v1/crm/accounts" + q)).toEqual({ ok: true, pathname: "/api/v1/crm/accounts" });
    }
  });

  it("a request with %25 / ';' / a long value in the QUERY reaches the upstream untouched", async () => {
    const q = `?search=100%25&tags=a;b&note=${"n".repeat(3000)}`;
    const res = await raw("GET", "/api/v1/careers/openings" + q, { contentType: null, body: "" });
    expect(res.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0]).toContain("search=100%25&tags=a;b&note=");
  });
});

describe("existing public routes still work", () => {
  it.each([
    ["GET", "/api/v1/careers/openings"],
    ["GET", "/api/v1/hrms/visiting-card/public/abc123"],
    ["POST", "/api/v1/crm/public/contact"],
    ["POST", "/api/v1/careers/apply"],
  ])("%s %s is anonymous and proxied", async (method, path) => {
    const res = await raw(method, path);
    expect(res.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
  });

  it("a non-public route still demands a bearer token", async () => {
    const res = await raw("POST", "/api/v1/crm/contacts");
    expect(res.status).toBe(401);
    expect(upstreamCalls).toEqual([]);
  });
});

describe("content-type allow-list (POST/PUT/PATCH)", () => {
  const WEBHOOKS = ["/api/v1/billing/webhooks", "/api/v1/telephony/webhooks"];
  const verdict = (m: string, ct: string | undefined, url = "/api/v1/x") => checkBodyContentType(m, ct, url, WEBHOOKS);

  it("allows json (with charset), text/plain, multipart with boundary", () => {
    for (const ct of [
      "application/json",
      "application/json; charset=utf-8",
      "Application/JSON;charset=UTF-8",
      "text/plain",
      "text/plain; charset=utf-8",
      "multipart/form-data; boundary=----WebKitFormBoundaryAbc123",
      'multipart/form-data; boundary="abc 123"',
    ]) {
      expect(verdict("POST", ct), ct).toEqual({ ok: true });
    }
  });

  it("rejects unknown types, multipart without boundary, and extra json parameters", () => {
    for (const ct of ["application/xml", "text/html", "application/octet-stream", "multipart/form-data", "multipart/form-data; charset=x", "application/json; foo=bar", "application/jsonx"]) {
      expect(verdict("PUT", ct).ok, ct).toBe(false);
    }
  });

  it("rejects control characters including TAB", () => {
    for (const ct of ["application/json;\tcharset=utf-8", "application/json\t", "application/js\x00on", "text/plain\x7f", "application/json\x0b"]) {
      expect(verdict("PATCH", ct), JSON.stringify(ct)).toEqual({ ok: false, reason: "control_char" });
    }
  });

  it("allows form-urlencoded only under the webhook prefixes", () => {
    const f = "application/x-www-form-urlencoded";
    expect(verdict("POST", f, "/api/v1/billing/webhooks/razorpay").ok).toBe(true);
    expect(verdict("POST", f, "/api/v1/telephony/webhooks/twilio?x=1").ok).toBe(true);
    expect(verdict("POST", f, "/api/v1/crm/public/contact").ok).toBe(false);
    expect(verdict("POST", f, "/api/v1/billing/webhooksX").ok).toBe(false);
  });

  it("ignores GET/DELETE and an absent content-type", () => {
    expect(verdict("GET", "application/xml").ok).toBe(true);
    expect(verdict("DELETE", "application/xml").ok).toBe(true);
    expect(verdict("POST", undefined).ok).toBe(true);
  });

  it("edge answers 415 for an unknown content-type and proxies nothing", async () => {
    const res = await raw("POST", "/api/v1/crm/public/contact", { contentType: "application/xml", body: "<a/>" });
    expect(res.status).toBe(415);
    expect(JSON.parse(res.body).code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(upstreamCalls).toEqual([]);
  });

  it("edge answers 415 for a tab inside the content-type header", async () => {
    const res = await raw("POST", "/api/v1/crm/public/contact", { contentType: "application/json;\tcharset=utf-8" });
    expect(res.status).toBe(415);
    expect(upstreamCalls).toEqual([]);
  });

  it("edge answers 415 for form-urlencoded on a non-webhook route", async () => {
    const res = await raw("POST", "/api/v1/crm/public/contact", { contentType: "application/x-www-form-urlencoded", body: "a=b" });
    expect(res.status).toBe(415);
  });

  it("edge still accepts the webhook form-urlencoded and normal JSON", async () => {
    const hook = await raw("POST", "/api/v1/billing/webhooks/payu", { contentType: "application/x-www-form-urlencoded", body: "a=b" });
    expect(hook.status).toBe(200);
    const json = await raw("POST", "/api/v1/crm/public/contact", { contentType: "application/json; charset=utf-8" });
    expect(json.status).toBe(200);
  });
});
