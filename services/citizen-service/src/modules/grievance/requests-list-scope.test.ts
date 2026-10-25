import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const listRequests = vi.fn(async (..._a: unknown[]) => []);
vi.mock("./queries.js", () => ({ listRequests: (...a: unknown[]) => listRequests(...a) }));
vi.mock("../../shared/context.js", async (orig) => {
  const actual = await orig<typeof import("../../shared/context.js")>();
  return {
    ...actual,
    resolveContext: (req: { headers: Record<string, string | undefined> }) => ({
      tenantId: "t1",
      actorId: req.headers["x-actor"] ?? A,
      roles: (req.headers["x-roles"] ?? "citizen").split(","),
      permissions: [],
    }),
  };
});

import { grievanceRoutes } from "./routes.js";

const A = globalThis.crypto.randomUUID();
const B = globalThis.crypto.randomUUID();

async function call(roles: string, actor = A, qs = "") {
  const app = Fastify();
  await app.register(grievanceRoutes);
  const res = await app.inject({
    method: "GET", url: `/v1/citizen/requests${qs}`,
    headers: { "x-roles": roles, "x-actor": actor },
  });
  await app.close();
  return res;
}

describe("V4-E-02 GET /v1/citizen/requests scoping", () => {
  beforeEach(() => listRequests.mockClear());

  it("scopes a citizen to their own actorId", async () => {
    const res = await call("citizen", A);
    expect(res.statusCode).toBe(200);
    expect(listRequests.mock.calls[0]?.[3]).toBe(A);
  });

  it("does not let a citizen widen scope via citizenId query", async () => {
    const res = await call("citizen", A, `?citizenId=${B}`);
    expect(res.statusCode).toBe(403);
    expect(listRequests).not.toHaveBeenCalled();
  });

  it("lets an officer list tenant-wide (no citizen scope)", async () => {
    const res = await call("citizen_officer", B);
    expect(res.statusCode).toBe(200);
    expect(listRequests.mock.calls[0]?.[3]).toBeUndefined();
  });
});
