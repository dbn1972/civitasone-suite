import { describe, it, expect, vi } from "vitest";

const jar = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (n: string) => (jar.values[n] !== undefined ? { value: jar.values[n] } : undefined) }),
}));

import { GET, POST } from "./route";
import { COOKIE } from "@/lib/auth/config";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

describe("/api/auth/refresh (A11Y-01 session timing)", () => {
  it("reports timing only -- never the tokens -- and is not cacheable", async () => {
    const now = Math.floor(Date.now() / 1000);
    const at = jwt({ sub: "u", iat: now, exp: now + 1800 });
    const rt = jwt({ typ: "Refresh", iat: now, exp: now + 1800 });
    jar.values = { [COOKIE.ACCESS]: at, [COOKIE.REFRESH]: rt };
    for (const handler of [GET, POST]) {
      const res = await handler();
      expect(res.headers.get("cache-control")).toBe("no-store");
      const text = await res.text();
      expect(text).not.toContain(at);
      expect(text).not.toContain(rt);
      expect(JSON.parse(text)).toEqual({
        authenticated: true,
        accessExpiresAt: (now + 1800) * 1000,
        sessionExpiresAt: (now + 1800) * 1000,
        idleTimeoutSec: 1800,
        refreshable: true,
      });
    }
  });

  it("reports unauthenticated without cookies", async () => {
    jar.values = {};
    expect((await (await GET()).json()).authenticated).toBe(false);
  });
});
