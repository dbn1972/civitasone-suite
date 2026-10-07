import { randomBytes, randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// GAP-SANDBOX-HOME-02: these tests assert the NEW route behaviour and fail on
// the old code (the route did not exist; cards linked straight to /dashboard).

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

beforeEach(() => {
  process.env.ENABLE_SANDBOX = "true";
  demoTenant = randomUUID();
  process.env.DEMO_TENANT_ID = demoTenant;
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/sandbox/enter", () => {
  it("returns 404 when ENABLE_SANDBOX is not 'true' (fail closed)", async () => {
    process.env.ENABLE_SANDBOX = "false";
    const { GET } = await load();
    const res = await GET(new Request("https://demo.test/api/sandbox/enter?role=citizen"));
    expect(res.status).toBe(404);
  });

  it("returns 400 for an unknown role param", async () => {
    const { GET } = await load();
    const res = await GET(new Request("https://demo.test/api/sandbox/enter?role=hacker"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when role param is missing", async () => {
    const { GET } = await load();
    const res = await GET(new Request("https://demo.test/api/sandbox/enter"));
    expect(res.status).toBe(400);
  });

  it("redirects to /dashboard and sets a demo-tenant session cookie for a valid role", async () => {
    const { GET } = await load();
    const res = await GET(new Request("https://demo.test/api/sandbox/enter?role=office-head", {
      headers: { host: "demo.test" },
    }));
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

  it("never grants super_admin to any public persona", async () => {
    const { GET } = await load();
    for (const role of [
      "office-head", "finance-clerk", "hr-officer", "procurement",
      "small-business", "citizen", "admin",
    ]) {
      const res = await GET(new Request(`https://demo.test/api/sandbox/enter?role=${role}`));
      expect(res.status).toBe(303);
      const payload = decodePayload(res.cookies.get("civitasone_at")!.value);
      expect(payload.roles).not.toContain("super_admin");
      expect(payload.tenantId).toBe(demoTenant);
    }
  });

  it("returns 404 when JWT_SECRET is unset (no fallback signing secret)", async () => {
    delete process.env.JWT_SECRET;
    const { GET } = await load();
    const res = await GET(new Request("https://demo.test/api/sandbox/enter?role=citizen"));
    expect(res.status).toBe(404);
    expect(res.cookies.get("civitasone_at")).toBeUndefined();
  });

  it("returns 404 when DEMO_TENANT_ID is unset (no fallback tenant)", async () => {
    delete process.env.DEMO_TENANT_ID;
    const { GET } = await load();
    const res = await GET(new Request("https://demo.test/api/sandbox/enter?role=citizen"));
    expect(res.status).toBe(404);
  });

  it("refuses the dev default tenant in production", async () => {
    process.env.DEMO_TENANT_ID = "00000000-0000-0000-0000-000000000001";
    (process.env as Record<string, string>).NODE_ENV = "production";
    const { GET } = await load();
    const res = await GET(new Request("https://demo.test/api/sandbox/enter?role=citizen"));
    expect(res.status).toBe(404);
  });
});
