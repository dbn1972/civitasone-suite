import { describe, it, expect, vi } from "vitest";

const cookieValue = vi.hoisted(() => ({ v: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (cookieValue.v ? { value: cookieValue.v } : undefined) }) }));

import { GET } from "./route";

function token(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

describe("GET /api/auth/session", () => {
  it("reports unauthenticated without a cookie", async () => {
    cookieValue.v = undefined;
    expect(await (await GET()).json()).toEqual({ authenticated: false });
  });

  it("returns tenant, user and the roles claim (strings only)", async () => {
    cookieValue.v = token({ sub: "u-1", tid: "t-1", roles: ["hr_admin", 5, "finance_officer"] });
    expect(await (await GET()).json()).toEqual({ authenticated: true, tenantId: "t-1", userId: "u-1", roles: ["hr_admin", "finance_officer"] });
  });

  it("returns an empty roles list when the claim is absent", async () => {
    cookieValue.v = token({ sub: "u-1", tid: "t-1" });
    expect((await (await GET()).json()).roles).toEqual([]);
  });
});
