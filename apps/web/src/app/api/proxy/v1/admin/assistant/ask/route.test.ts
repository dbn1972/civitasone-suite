import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GAP2-SHELL-PROXY-02 — the hard-coded /api/proxy/v1/admin/assistant/ask route
 * shadows the generic /api/proxy/[...path] pass-through but, on main, performs
 * NO session-cookie check: it answered anyone. Every other /api/proxy/* path
 * returns 401 without a session cookie. This test asserts the ask route now
 * matches: 401 with no cookie, a body-size guard, and a normal answer when a
 * session cookie is present. The no-cookie 401 case fails on the old code.
 */

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }),
}));

import { POST } from "./route";

function makeReq(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/proxy/v1/admin/assistant/ask", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  }) as unknown as Parameters<typeof POST>[0];
}

describe("GAP2-SHELL-PROXY-02 — assistant/ask session gate", () => {
  beforeEach(() => {
    cookieValue = undefined;
  });

  it("returns 401 when there is no session cookie (matches the pass-through)", async () => {
    cookieValue = undefined;
    const res = await POST(makeReq(JSON.stringify({ question: "what is a challan?" })));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
  });

  it("answers a glossary question when a session cookie is present", async () => {
    cookieValue = randomUUID();
    const res = await POST(makeReq(JSON.stringify({ question: "what is a challan?" })));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("answer");
    expect(json).toHaveProperty("sources");
  });

  it("rejects an oversized body with 413", async () => {
    cookieValue = randomUUID();
    const huge = JSON.stringify({ question: "x".repeat(20 * 1024) });
    const res = await POST(makeReq(huge));
    expect(res.status).toBe(413);
  });
});
