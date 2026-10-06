import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The route reads env at request time via assertDevLoginConfig(); set a valid
// baseline before importing, then override per-test with vi.stubEnv.
const GOOD_SECRET = "s".repeat(40);
const GOOD_PASSWORD = "p".repeat(12);
const ORIGIN = "https://civitasone.example.gov.in";

function formRequest(
  fields: Record<string, string>,
  opts: { origin?: string | null; host?: string } = {},
): Request {
  const body = new URLSearchParams(fields).toString();
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    host: opts.host ?? "civitasone.example.gov.in",
    "x-forwarded-proto": "https",
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  return new Request(`${ORIGIN}/api/auth/dev-login`, { method: "POST", headers, body });
}

async function loadRoute() {
  // Fresh module each time so the in-memory throttle map starts empty.
  vi.resetModules();
  return import("./route");
}

describe("POST /api/auth/dev-login", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("ENABLE_DEV_LOGIN", "true");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JWT_SECRET", GOOD_SECRET);
    vi.stubEnv("DEV_LOGIN_PASSWORD", GOOD_PASSWORD);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("DEV-01: returns 404 when dev login is disabled", async () => {
    vi.stubEnv("ENABLE_DEV_LOGIN", "false");
    const { POST } = await loadRoute();
    const res = await POST(formRequest({ username: "superadmin", password: GOOD_PASSWORD }));
    expect(res.status).toBe(404);
  });

  it("DEV-01: with DEV_LOGIN_PASSWORD unset, any POST returns 404 (fail closed)", async () => {
    vi.stubEnv("DEV_LOGIN_PASSWORD", "");
    const { POST } = await loadRoute();
    const res = await POST(formRequest({ username: "superadmin", password: "" }));
    expect(res.status).toBe(404);
  });

  it("DEV-01: refuses to run in production even when flag + secret set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = await loadRoute();
    const res = await POST(formRequest({ username: "superadmin", password: GOOD_PASSWORD }));
    expect(res.status).toBe(404);
  });

  it("DEV-01: an empty submitted password never matches (303 to ?error=1)", async () => {
    const { POST } = await loadRoute();
    const res = await POST(formRequest({ username: "superadmin", password: "" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/auth/dev?error=1");
  });

  it("DEV-02: rejects a cross-origin form POST with 403", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      formRequest({ username: "superadmin", password: GOOD_PASSWORD }, { origin: "https://evil.example.com" }),
    );
    expect(res.status).toBe(403);
  });

  it("DEV-02: rejects a POST with no Origin/Referer with 403", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      formRequest({ username: "superadmin", password: GOOD_PASSWORD }, { origin: null }),
    );
    expect(res.status).toBe(403);
  });

  it("DEV-02: 6 bad attempts in a window -> 429", async () => {
    const { POST } = await loadRoute();
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) {
      last = await POST(formRequest({ username: "superadmin", password: "wrong" }));
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBe("60");
  });

  it("DEV-04: rejects input that violates the zod schema (over-length username) -> 303 ?error=1", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      formRequest({ username: "a".repeat(200), password: GOOD_PASSWORD }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/auth/dev?error=1");
  });

  it("accepts a valid login and sets the session cookie, redirecting to a safe next", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      formRequest({ username: "superadmin", password: GOOD_PASSWORD, next: "/dashboard/x" }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/dashboard/x");
    expect(res.headers.get("set-cookie")).toContain("civitasone_at=");
  });

  it("rejects an open-redirect next and falls back to /dashboard", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      formRequest({ username: "superadmin", password: GOOD_PASSWORD, next: "//evil.com" }),
    );
    expect(res.headers.get("location")).toContain("/dashboard");
    expect(res.headers.get("location")).not.toContain("evil.com");
  });

  it("rejects a backslash open-redirect next (/\\evil.com) and falls back to /dashboard", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      formRequest({ username: "superadmin", password: GOOD_PASSWORD, next: "/\\evil.com" }),
    );
    expect(res.headers.get("location")).toContain("/dashboard");
    expect(res.headers.get("location")).not.toContain("evil.com");
  });
});
