/**
 * GET /v1/finance/actors?ids=... -- actor id -> display name for the finance pages (payments detail,
 * vendors, cheques, audit paras, reconciliation exceptions). The web loader getFinanceActorNames has always
 * called it. identity-service is mocked; no Postgres needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { signToken } from "@civitasone/auth";

vi.mock("../src/modules/payments/repo.js", () => ({}));
vi.mock("../src/modules/masters/repo.js", () => ({}));
vi.mock("../src/modules/payments/commands.js", () => ({}));

import { paymentsRoutes } from "../src/modules/payments/routes.js";
import { financeErrorHandler } from "../src/shared/context.js";

// Set by the service vitest config (never a literal in a test file: CI scans every commit for secrets).
const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000c1";
const ASHA = "11111111-aaaa-4000-8000-0000000000c1";
const BEN = "22222222-aaaa-4000-8000-0000000000c1";
const OTHER = "33333333-aaaa-4000-8000-0000000000c1";

const hdr = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ASHA, tid: TENANT, roles, sid: "s" }, SECRET)}` });
async function app() {
  const a = Fastify();
  a.setErrorHandler(financeErrorHandler);
  await a.register(paymentsRoutes);
  await a.ready();
  return a;
}

// The real identity-client runs; only its network call (identity-service's internal user-summaries feed) is stubbed.
const identityCalls: { url: string; tenant: string | undefined }[] = [];
function stubIdentity(rows: { id: string; name: string }[] | "down") {
  identityCalls.length = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    identityCalls.push({ url: String(input), tenant: (init?.headers as Record<string, string> | undefined)?.["x-tenant-id"] });
    if (rows === "down") throw new Error("identity-service unreachable");
    return new Response(JSON.stringify(rows), { status: 200 });
  });
}

describe("GET /v1/finance/actors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubIdentity([{ id: ASHA, name: "Asha Rao" }, { id: BEN, name: "Ben Iyer" }, { id: OTHER, name: "Not Requested" }]);
  });

  it("returns {id, name} for just the ids asked for, scoped to the caller's tenant", async () => {
    const res = await (await app()).inject({ method: "GET", url: `/v1/finance/actors?ids=${ASHA},${BEN}`, headers: hdr(["finance_officer"]) });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as { id: string; name: string }[];
    expect(data.sort((a, b) => a.id.localeCompare(b.id))).toEqual([{ id: ASHA, name: "Asha Rao" }, { id: BEN, name: "Ben Iyer" }]);
    expect(identityCalls).toHaveLength(1);
    expect(identityCalls[0]).toMatchObject({ url: expect.stringContaining("/identity/internal/user-summaries"), tenant: TENANT });
  });

  it("drops entries that are not UUIDs, and ids with no known user", async () => {
    const res = await (await app()).inject({
      method: "GET", url: `/v1/finance/actors?ids=not-a-uuid,${ASHA},44444444-aaaa-4000-8000-0000000000c1`, headers: hdr(["audit_officer"]),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toEqual([{ id: ASHA, name: "Asha Rao" }]);
  });

  it("answers an empty list, without calling identity-service, when no usable id is given", async () => {
    const res = await (await app()).inject({ method: "GET", url: "/v1/finance/actors?ids=nope", headers: hdr(["finance_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toEqual([]);
    expect(identityCalls).toHaveLength(0);
  });

  it("fails open to an empty list when identity-service is unreachable (no names, no 5xx)", async () => {
    stubIdentity("down");
    const res = await (await app()).inject({ method: "GET", url: `/v1/finance/actors?ids=${ASHA}`, headers: hdr(["finance_officer"]) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toEqual([]);
  });

  it("looks up at most 50 ids", async () => {
    const many = Array.from({ length: 80 }, (_, i) => `00000000-aaaa-4000-8000-${String(i).padStart(12, "0")}`);
    stubIdentity(many.map((id) => ({ id, name: `U${id.slice(-2)}` })));
    const res = await (await app()).inject({ method: "GET", url: `/v1/finance/actors?ids=${many.join(",")}`, headers: hdr(["finance_officer"]) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toHaveLength(50);
  });

  it("is refused (403) for a role with no finance access, and without a token (401)", async () => {
    const a = await app();
    const denied = await a.inject({ method: "GET", url: `/v1/finance/actors?ids=${ASHA}`, headers: hdr(["employee"]) });
    expect(denied.statusCode).toBe(403);
    const anon = await a.inject({ method: "GET", url: `/v1/finance/actors?ids=${ASHA}` });
    expect(anon.statusCode).toBe(401);
    expect(identityCalls).toHaveLength(0);
  });
});
