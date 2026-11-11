import { describe, it, expect, vi, afterEach } from "vitest";
import { POST } from "./route";

// generated per run: no password literal lives in the repo
const PASSWORD = `Aa1!${crypto.randomUUID()}`;
const post = (body: unknown) => new Request("http://localhost/api/auth/set-password", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("POST /api/auth/set-password", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards token + password to the gateway's public redeem route with no credentials, and relays only code/message/status", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "password_set", leaked: PASSWORD }), { status: 200 }));
    const res = await POST(post({ token: "t".repeat(60), password: PASSWORD }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/identity\/password-setup\/redeem$/);
    expect((init as RequestInit).headers).toEqual({ "content-type": "application/json" });
    // ...and the client address chain is passed on when the proxy supplied one
    await POST(new Request("http://localhost/api/auth/set-password", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, body: JSON.stringify({ token: "t".repeat(60), password: PASSWORD }) }));
    expect(((spy.mock.calls[1]![1] as RequestInit).headers as Record<string, string>)["x-forwarded-for"]).toBe("203.0.113.9, 10.0.0.1");
    const out = await res.text();
    expect(out).not.toContain(PASSWORD); // unknown fields from upstream are dropped
    expect(JSON.parse(out)).toEqual({ status: "password_set" });
  });

  it("passes an upstream refusal through with its status and stable code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "PASSWORD_POLICY", message: "policy" }), { status: 422 }));
    const res = await POST(post({ token: "t".repeat(60), password: "x" }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("PASSWORD_POLICY");
  });

  it("rejects malformed bodies without calling upstream", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({ token: 1, password: 2 }))).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("answers 503 when the gateway is unreachable, without leaking the error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`boom ${PASSWORD}`));
    const res = await POST(post({ token: "t".repeat(60), password: PASSWORD }));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(PASSWORD);
  });
});
