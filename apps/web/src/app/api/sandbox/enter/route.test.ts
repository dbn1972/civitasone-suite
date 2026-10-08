import { randomBytes, randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// GAP-SANDBOX-HOME-02 + GAP2-SHELL-SANDBOX-01: the route now establishes a
// session only via a same-origin POST (CSRF-gated), never a GET. These tests
// assert the POST behaviour and the CSRF gate; the "no GET export" and
// "cross-site POST rejected" cases fail on the old GET-based code.

const ORIGINAL_ENV = { ...process.env };
let demoTenant = "";

async function load() {
  // Re-import fresh so module-level reads of env (SECRET, DEMO_TENANT) and the
  // isSandboxEnabled() gate observe the per-test env.
  const mod = await import("./route");
  return mod;
}

function decodePayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1]!;
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/** A same-origin POST carrying role in the form body + an Origin header. */
function enterReq(role: string | null, opts: { origin?: string | null; host?: string } = {}) {
  const host = opts.host ?? "demo.test";
  const params = new URLSearchParams();
  if (role !== null) params.set("role", role);
  const headers: Record<string, string> = {
    host,
    "content-type": "application/x-www-form-urlencoded",
  };
  if (opts.origin !== null) headers["origin"] = opts.origin ?? `https://${host}`;
  return new Request(`https://${host}/api/sandbox/enter`, {
    method: "POST",
    headers,
    body: params.toString(),
  });
}

beforeEach(() => {
  process.env.ENABLE_SANDBOX = "true";
  demoTenant = randomUUID();
  process.env.DEMO_TENANT_ID = demoTenant;
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/sandbox/enter", () => {
  it("does NOT export a GET handler (session mint must not ride a GET)", async () => {
    const mod = await load();
    expect((mod as Record<string, unknown>).GET).toBeUndefined();
    expect(typeof (mod as Record<string, unknown>).POST).toBe("function");
  });

  it("returns 404 when ENABLE_SANDBOX is not 'true' (fail closed)", async () => {
    process.env.ENABLE_SANDBOX = "false";
    const { POST } = await load();
    const res = await POST(enterReq("citizen"));
    expect(res.status).toBe(404);
  });

  it("rejects a cross-site POST (CSRF gate) with 403 and sets no cookie", async () => {
    const { POST } = await load();
    const res = await POST(enterReq("office-head", { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(res.cookies.get("civitasone_at")).toBeUndefined();
  });

  it("rejects a POST with neither Origin nor Referer (fail closed)", async () => {
    const { POST } = await load();
    const res = await POST(enterReq("office-head", { origin: null }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for an unknown role", async () => {
    const { POST } = await load();
    const res = await POST(enterReq("hacker"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when role is missing", async () => {
    const { POST } = await load();
    const res = await POST(enterReq(null));
    expect(res.status).toBe(400);
  });

  it("redirects to /dashboard and sets a demo-tenant session cookie for a valid same-origin POST", async () => {
    const { POST } = await load();
    const res = await POST(enterReq("office-head"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://demo.test/dashboard");
    const cookie = res.cookies.get("civitasone_at");
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    const payload = decodePayload(cookie!.value);
    expect(payload.tenantId).toBe(demoTenant);
    expect(payload.sandbox).toBe(true);
    expect(payload.roles).toEqual(["tenant_admin", "reader", "viewer"]);
  });

  it("accepts a same-origin Referer when Origin is absent", async () => {
    const { POST } = await load();
    const req = new Request("https://demo.test/api/sandbox/enter", {
      method: "POST",
      headers: {
        host: "demo.test",
        "content-type": "application/x-www-form-urlencoded",
        referer: "https://demo.test/sandbox",
      },
      body: new URLSearchParams({ role: "citizen" }).toString(),
    });
    const res = await POST(req);
    expect(res.status).toBe(303);
  });

  it("never grants super_admin to any public persona", async () => {
    const { POST } = await load();
    for (const role of [
      "office-head", "finance-clerk", "hr-officer", "procurement",
      "small-business", "citizen", "admin",
    ]) {
      const res = await POST(enterReq(role));
      expect(res.status).toBe(303);
      const payload = decodePayload(res.cookies.get("civitasone_at")!.value);
      expect(payload.roles).not.toContain("super_admin");
      expect(payload.tenantId).toBe(demoTenant);
    }
  });

  it("returns 404 when JWT_SECRET is unset (no fallback signing secret)", async () => {
    delete process.env.JWT_SECRET;
    const { POST } = await load();
    const res = await POST(enterReq("citizen"));
    expect(res.status).toBe(404);
    expect(res.cookies.get("civitasone_at")).toBeUndefined();
  });

  it("returns 404 when DEMO_TENANT_ID is unset (no fallback tenant)", async () => {
    delete process.env.DEMO_TENANT_ID;
    const { POST } = await load();
    const res = await POST(enterReq("citizen"));
    expect(res.status).toBe(404);
  });

  it("refuses the dev default tenant in production", async () => {
    process.env.DEMO_TENANT_ID = "00000000-0000-0000-0000-000000000001";
    (process.env as Record<string, string>).NODE_ENV = "production";
    const { POST } = await load();
    const res = await POST(enterReq("citizen"));
    expect(res.status).toBe(404);
  });
});
