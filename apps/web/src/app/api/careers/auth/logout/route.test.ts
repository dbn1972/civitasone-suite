import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";

describe("POST /api/careers/auth/logout", () => {
  it("clears the httpOnly cand_token cookie and redirects to login", async () => {
    const res = await POST();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/careers/portal/login");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/cand_token=;/);
    expect(cookie).toMatch(/Max-Age=0/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/SameSite=lax/i);
    vi.stubEnv("NODE_ENV", "production");
    const prod = await POST();
    expect(prod.headers.get("set-cookie") ?? "").toMatch(/Secure/i);
    vi.unstubAllEnvs();
  });
});
