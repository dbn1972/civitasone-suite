/**
 * GAP2-HELPDESK-CATALOGUE-REQUEST-IDOR-01 — GET /v1/helpdesk/catalogue/requests/:id
 * returned the full request (including requester-entered formData PII) for ANY
 * request id to any helpdesk_user, scoped only by tenant. After the fix a
 * helpdesk_user may only read their OWN request detail; agents/admins see all.
 *
 * Before the fix a non-owning helpdesk_user got 200 + formData. This test
 * fails on the old code.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { catalogueOfferings, serviceRequests } from "../src/modules/catalogue/schema.js";

vi.mock("../src/shared/infra.js", async () => {
  const { MemoryQueue } = await import("@civitasone/queue");
  const q = new MemoryQueue();
  return {
    queue: q,
    cache: {
      invalidate: vi.fn(),
      makeKey: (...parts: string[]) => parts.join(":"),
      getOrLoad: vi.fn(),
      put: vi.fn(),
      invalidateResource: vi.fn(),
      listOrLoad: vi.fn(),
    },
  };
});

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = "aaaaaaaa-0000-4000-8000-00000000cf01";
const OWNER = randomUUID();
const OTHER = randomUUID();
const AGENT = randomUUID();
const OFFERING_ID = randomUUID();
const REQUEST_ID = randomUUID();

function token(sub: string, roles: string[]) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-idor" }, SECRET, 3600);
}
const ownerTok = token(OWNER, ["helpdesk_user"]);
const otherTok = token(OTHER, ["helpdesk_user"]);
const agentTok = token(AGENT, ["helpdesk_agent"]);

let app: FastifyInstance;

async function seed() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(catalogueOfferings).values({
        id: OFFERING_ID, tenantId: TENANT, name: "Laptop Request", category: "it",
        createdBy: OWNER, updatedBy: OWNER,
      });
      await tx.insert(serviceRequests).values({
        id: REQUEST_ID, tenantId: TENANT, offeringId: OFFERING_ID, requestedBy: OWNER,
        formData: { phone: "9999999999", reason: "sensitive personal note" },
        status: "pending_fulfilment", createdBy: OWNER, updatedBy: OWNER,
      });
    }),
  );
}

async function cleanup() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(serviceRequests).where(eq(serviceRequests.tenantId, TENANT));
      await tx.delete(catalogueOfferings).where(eq(catalogueOfferings.tenantId, TENANT));
    }),
  );
}

beforeAll(async () => { app = await buildApp(); await cleanup(); await seed(); });
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

function get(tok: string) {
  return app.inject({ method: "GET", url: `/v1/helpdesk/catalogue/requests/${REQUEST_ID}`, headers: { authorization: `Bearer ${tok}` } });
}

describe("GAP2-HELPDESK-CATALOGUE-REQUEST-IDOR-01", () => {
  it("a non-owning helpdesk_user is 404 (no formData leak)", async () => {
    const res = await get(otherTok);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("sensitive personal note");
  });

  it("the owning helpdesk_user may read their own request", async () => {
    const res = await get(ownerTok);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { requestedBy: string; formData: Record<string, unknown> } };
    expect(body.data.requestedBy).toBe(OWNER);
    expect(body.data.formData.reason).toBe("sensitive personal note");
  });

  it("an agent may read any request", async () => {
    const res = await get(agentTok);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { requestedBy: string } }).data.requestedBy).toBe(OWNER);
  });
});
