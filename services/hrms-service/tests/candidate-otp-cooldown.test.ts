import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

const H = vi.hoisted(() => ({ latestAgeMs: 5000, publish: vi.fn(async () => undefined) }));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "cand-1", fullName: "A" }] }) }) }),
  }),
}));
vi.mock("../src/modules/recruitment/otp-verify-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findLatestChallengeTx: async () => ({ createdAt: new Date(Date.now() - H.latestAgeMs) }),
}));
vi.mock("../src/shared/infra.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  queue: { publish: H.publish, send: H.publish },
}));
vi.mock("@civitasone/db", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  runWithTenant: async (_t: string, fn: () => unknown) => fn(),
}));

import { candidatePublicAuthRoutes } from "../src/modules/recruitment/candidate-public-auth-routes.js";

describe("otp-request cooldown", () => {
  it("returns 429 OTP_COOLDOWN with Retry-After when a code was issued < 30s ago", async () => {
    H.latestAgeMs = 5000;
    const app = Fastify();
    await app.register(candidatePublicAuthRoutes);
    const res = await app.inject({ method: "POST", url: "/v1/careers/auth/otp-request", payload: { email: "a@example.com", tenantId: "aaaaaaaa-0001-4000-8000-00000000a001" } });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe("OTP_COOLDOWN");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });
});
