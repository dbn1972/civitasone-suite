import { describe, it, expect, vi, beforeEach } from "vitest";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AuthLayout from "./layout";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

function jarWith(token: string | undefined) {
  return {
    get: (name: string) =>
      name === "civitasone_at" && token !== undefined ? { value: token } : undefined,
  };
}

function tokenWithExp(expSecondsFromNow: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })).toString(
    "base64url",
  );
  return `h.${payload}.sig`;
}

describe("AuthLayout (GAP-AUTH-DEV-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a signed-in user (live token) away from /auth/*", () => {
    vi.mocked(cookies).mockReturnValue(jarWith(tokenWithExp(3600)) as unknown as ReturnType<typeof cookies>);
    AuthLayout({ children: "x" });
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("does NOT redirect when there is no session cookie", () => {
    vi.mocked(cookies).mockReturnValue(jarWith(undefined) as unknown as ReturnType<typeof cookies>);
    AuthLayout({ children: "x" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does NOT redirect on an expired-but-present cookie (no redirect loop)", () => {
    vi.mocked(cookies).mockReturnValue(jarWith(tokenWithExp(-10)) as unknown as ReturnType<typeof cookies>);
    AuthLayout({ children: "x" });
    expect(redirect).not.toHaveBeenCalled();
  });
});
