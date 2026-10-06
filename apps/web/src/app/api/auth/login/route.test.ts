import { describe, it, expect, vi, beforeEach } from "vitest";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildAuthorizeUrl } from "@civitasone/client-core";
import { COOKIE } from "@/lib/auth/config";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@civitasone/client-core", () => ({
  generatePkcePair: vi.fn(async () => ({ codeVerifier: "v", codeChallenge: "c", method: "S256" })),
  buildAuthorizeUrl: vi.fn(() => "https://kc.example/authorize"),
  exchangeAuthorizationCode: vi.fn(),
}));

function makeJar() {
  const store: Record<string, string> = {};
  return {
    set: vi.fn((name: string, value: string) => {
      store[name] = value;
    }),
    delete: vi.fn((name: string) => {
      delete store[name];
    }),
    get: (name: string) => (store[name] !== undefined ? { value: store[name] } : undefined),
    _store: store,
  };
}

describe("GET /api/auth/login (GAP-AUTH-LOGIN-02)", () => {
  let jar: ReturnType<typeof makeJar>;
  beforeEach(() => {
    vi.clearAllMocks();
    jar = makeJar();
    vi.mocked(cookies).mockReturnValue(jar as unknown as ReturnType<typeof cookies>);
  });

  it("stores a validated same-origin next in a short-lived cookie", async () => {
    const { GET } = await import("./route");
    await GET(new Request("https://app.example/api/auth/login?next=/dashboard/x"));
    expect(jar.set).toHaveBeenCalledWith(
      COOKIE.POST_LOGIN_NEXT,
      "/dashboard/x",
      expect.objectContaining({ httpOnly: true, maxAge: 600 }),
    );
    expect(redirect).toHaveBeenCalledWith("https://kc.example/authorize");
    expect(buildAuthorizeUrl).toHaveBeenCalled();
  });

  it("does not store an open-redirect next, and clears any stale value", async () => {
    const { GET } = await import("./route");
    await GET(new Request("https://app.example/api/auth/login?next=//evil.com"));
    expect(jar.set).not.toHaveBeenCalledWith(COOKIE.POST_LOGIN_NEXT, expect.anything(), expect.anything());
    expect(jar.delete).toHaveBeenCalledWith(COOKIE.POST_LOGIN_NEXT);
  });

  it("does not store a backslash open-redirect next (/\\evil.com)", async () => {
    const { GET } = await import("./route");
    await GET(new Request("https://app.example/api/auth/login?next=/%5Cevil.com"));
    expect(jar.set).not.toHaveBeenCalledWith(COOKIE.POST_LOGIN_NEXT, expect.anything(), expect.anything());
    expect(jar.delete).toHaveBeenCalledWith(COOKIE.POST_LOGIN_NEXT);
  });
});
