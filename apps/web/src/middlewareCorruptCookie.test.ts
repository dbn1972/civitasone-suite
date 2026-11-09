import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { COOKIE } from "@/lib/auth/config";

// W7 (C-SESS-COOKIE-002): an access cookie that is not a decodable JWT, with no usable refresh
// cookie, must send pages to login and clear the bad cookie -- not render the app shell.

function req(path: string, cookies: Record<string, string>, headers: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(new URL(`https://demo.test${path}`), { headers: { ...(cookie ? { cookie } : {}), ...headers } });
}

describe("middleware corrupt access cookie (W7)", () => {
  it.each(["not.a.jwt", "garbage", "a.b.c", "x.bm90anNvbg.y"])("redirects a page request carrying access cookie %j to login and clears it", async (bad) => {
    const res = await middleware(req("/hr/leave", { [COOKIE.ACCESS]: bad }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login");
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE.ACCESS}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it("gives an XHR a JSON 401 instead of passing it through", async () => {
    const res = await middleware(req("/api/proxy/v1/hrms/leave-applications", { [COOKIE.ACCESS]: "not.a.jwt" }, { "sec-fetch-mode": "cors" }));
    expect(res.status).toBe(401);
  });

  it("still lets a structurally valid, unexpired token through", async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const ok = `${b64({ alg: "none" })}.${b64({ sub: "u", exp: Math.floor(Date.now() / 1000) + 1500 })}.sig`;
    const res = await middleware(req("/hr/leave", { [COOKIE.ACCESS]: ok }));
    expect(res.status).toBe(200);
  });
});
