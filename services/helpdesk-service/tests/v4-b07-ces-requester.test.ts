/**
 * V4-B-07 — POST /v1/helpdesk/csat/ces had no requester check: any tenant user
 * could submit a CES for any ticket, and the one-per-ticket 409 then locked out
 * the genuine requester. Before the fix the non-requester got 202.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";

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

const SECRET = process.env.JWT_SECRET!;
const uuid = () => globalThis.crypto.randomUUID();
const TENANT = uuid();
const OWNER = uuid();
const OTHER = uuid();
const TICKET_ID = uuid();

const tok = (sub: string) =>
  signToken({ sub, tid: TENANT, roles: ["helpdesk_user"], sid: "sess-v4-b07" }, SECRET, 3600);
const ownerTok = tok(OWNER);
const otherTok = tok(OTHER);

let app: FastifyInstance;

async function cleanup() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(tickets).where(eq(tickets.tenantId, TENANT));
    }),
  );
}

beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(tickets).values({
        id: TICKET_ID, tenantId: TENANT, subject: "t", createdBy: OWNER, updatedBy: OWNER,
      });
    }),
  );
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("V4-B-07 CES submission requires the ticket requester", () => {
  const post = (t: string, ticketId = TICKET_ID) =>
    app.inject({
      method: "POST", url: "/v1/helpdesk/csat/ces", headers: { authorization: `Bearer ${t}` },
      payload: { ticketId, effortScore: 3 },
    });

  it("a non-requester tenant user is refused (403) and cannot pre-empt the requester", async () => {
    const res = await post(otherTok);
    expect(res.statusCode).toBe(403);
  });

  it("the ticket requester can still submit after a refused attempt", async () => {
    const res = await post(ownerTok);
    expect(res.statusCode).toBe(202);
  });

  it("an unknown ticket is 404", async () => {
    const res = await post(ownerTok, uuid());
    expect(res.statusCode).toBe(404);
  });
});
