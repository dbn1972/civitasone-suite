/**
 * CS-004: Knowledge Article Linking — Agents can search and link approved
 * knowledge to cases.
 *
 * Tests for:
 * - POST /v1/helpdesk/tickets/:ticketId/knowledge (link)
 * - GET  /v1/helpdesk/tickets/:ticketId/knowledge (list)
 * - DELETE /v1/helpdesk/tickets/:ticketId/knowledge/:articleId (unlink)
 * - GET  /v1/helpdesk/knowledge/search?q=... (proxy)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient, db } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { ticketKnowledgeLinks } from "../src/modules/knowledge/schema.js";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-1111-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-2222-4000-8000-000000000002";
const ACTOR_A = "11111111-aaaa-4000-8000-000000000001";
const ACTOR_B = "22222222-bbbb-4000-8000-000000000002";
const TICKET_A = "cccccccc-3333-4000-8000-000000000a01";
const ARTICLE_1 = "dddddddd-4444-4000-8000-000000000001";
const ARTICLE_2 = "dddddddd-4444-4000-8000-000000000002";
const NON_EXISTENT_TICKET = "eeeeeeee-5555-4000-8000-000000000099";

function token(roles = ["helpdesk_user"], tenantId = TENANT_A, sub = ACTOR_A): string {
  return signToken({ sub, tid: tenantId, roles, sid: "sess-test" }, SECRET);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  // Seed a ticket for tenant A — must run inside tenant context for RLS
  try {
    await runWithTenant(TENANT_A, async () => {
      await db.transaction(async (tx) => {
        await tx.insert(tickets).values({
          id: TICKET_A,
          tenantId: TENANT_A,
          subject: "Test ticket for knowledge linking",
          priority: "Medium",
          status: "open",
          createdBy: ACTOR_A,
          updatedBy: ACTOR_A,
        }).onConflictDoNothing();
      });
    });
  } catch {
    // Table may not exist in unit test — tests that need DB will skip gracefully
  }
});

afterAll(async () => {
  // Clean up seeded data
  try {
    await runWithTenant(TENANT_A, async () => {
      await db.transaction(async (tx) => {
        await tx.delete(ticketKnowledgeLinks).where(eq(ticketKnowledgeLinks.tenantId, TENANT_A));
        await tx.delete(tickets).where(eq(tickets.id, TICKET_A));
      });
    });
  } catch {
    // Ignore cleanup errors
  }
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/helpdesk/tickets/:ticketId/knowledge", () => {
  it("returns 201 and persists link for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { articleId: ARTICLE_1, articleTitle: "How to reset password" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.ticketId).toBe(TICKET_A);
    expect(body.data.articleId).toBe(ARTICLE_1);
    expect(body.data.articleTitle).toBe("How to reset password");
    expect(body.data.linkedBy).toBe(ACTOR_A);
  });

  it("returns 200 (idempotent) for duplicate link — no duplicate row", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { articleId: ARTICLE_1, articleTitle: "How to reset password" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.articleId).toBe(ARTICLE_1);
  });

  it("returns 404 for non-existent ticket", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${NON_EXISTENT_TICKET}/knowledge`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { articleId: ARTICLE_2, articleTitle: "Some article" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("TICKET_NOT_FOUND");
  });

  it("returns 400 for invalid ticketId (non-uuid)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/not-a-uuid/knowledge",
      headers: { authorization: `Bearer ${token()}` },
      payload: { articleId: ARTICLE_1, articleTitle: "Article" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid articleId (non-uuid)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { articleId: "not-a-uuid", articleTitle: "Article" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing articleTitle", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { articleId: ARTICLE_2 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
      payload: { articleId: ARTICLE_1, articleTitle: "Article" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
      payload: { articleId: ARTICLE_1, articleTitle: "Article" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/helpdesk/tickets/:ticketId/knowledge", () => {
  it("returns 200 with linked articles", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
    const found = body.data.find((r: { articleId: string }) => r.articleId === ARTICLE_1);
    expect(found).toBeDefined();
    expect(found.articleTitle).toBe("How to reset password");
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/helpdesk/tickets/:ticketId/knowledge/:articleId", () => {
  it("returns 204 for valid unlink", async () => {
    // First link article 2 so we can unlink it
    await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { articleId: ARTICLE_2, articleTitle: "Another article" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge/${ARTICLE_2}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(204);

    // Verify it's gone
    const list = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
      headers: { authorization: `Bearer ${token()}` },
    });
    const found = list.json().data.find((r: { articleId: string }) => r.articleId === ARTICLE_2);
    expect(found).toBeUndefined();
  });

  it("returns 404 for non-existent link", async () => {
    const fakeArticle = "ffffffff-9999-4000-8000-000000000099";
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge/${fakeArticle}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("LINK_NOT_FOUND");
  });

  it("returns 400 for invalid articleId (non-uuid)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge/bad-id`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge/${ARTICLE_1}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge/${ARTICLE_1}`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Cross-tenant isolation", () => {
  it("tenant B cannot see tenant A's ticket knowledge links", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
      headers: { authorization: `Bearer ${token(["helpdesk_user"], TENANT_B, ACTOR_B)}` },
    });
    // Ticket does not exist in tenant B context — list returns empty (RLS)
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it("tenant B cannot link to tenant A's ticket", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/knowledge`,
      headers: { authorization: `Bearer ${token(["helpdesk_user"], TENANT_B, ACTOR_B)}` },
      payload: { articleId: ARTICLE_2, articleTitle: "Attempt cross-tenant" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("TICKET_NOT_FOUND");
  });
});

describe("GET /v1/helpdesk/knowledge/search", () => {
  it("proxies search request to knowledge-service and returns results", async () => {
    // Mock the global fetch to simulate knowledge-service
    const mockResults = { data: [{ id: ARTICLE_1, title: "Password Reset Guide", status: "published" }], meta: { total: 1 } };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResults), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/knowledge/search?q=password",
      headers: { authorization: `Bearer ${token()}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(mockResults);

    // Verify fetch was called with correct URL and headers
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/v1/knowledge/search?q=password");
    expect((opts as RequestInit).headers).toBeDefined();

    fetchSpy.mockRestore();
  });

  it("returns 503 when knowledge-service is down", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new TypeError("fetch failed"),
    );

    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/knowledge/search?q=test",
      headers: { authorization: `Bearer ${token()}` },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("KNOWLEDGE_SERVICE_UNAVAILABLE");

    fetchSpy.mockRestore();
  });

  it("returns 503 on AbortError (timeout)", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/knowledge/search?q=slow",
      headers: { authorization: `Bearer ${token()}` },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("KNOWLEDGE_SERVICE_UNAVAILABLE");

    fetchSpy.mockRestore();
  });

  it("returns 400 for missing query param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/knowledge/search",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/knowledge/search?q=test",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/knowledge/search?q=test",
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("passes through non-200 from knowledge-service", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/knowledge/search?q=missing",
      headers: { authorization: `Bearer ${token()}` },
    });

    expect(res.statusCode).toBe(404);
    fetchSpy.mockRestore();
  });
});
