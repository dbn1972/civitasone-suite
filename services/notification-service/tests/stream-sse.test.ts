/**
 * Real-Time Notifications SSE Endpoint Tests
 *
 * Tests: SSE connection setup, message delivery, offline persistence,
 * tenant isolation, auth (401), mark-as-read, and publish endpoint.
 *
 * Note: SSE endpoint tests use actual HTTP connections since reply.hijack()
 * prevents Fastify inject from resolving. We test SSE via a brief listen.
 */
import { describe, it, expect, afterAll, afterEach, beforeEach } from "vitest";
import http from "node:http";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient, db } from "../src/shared/db.js";
import { notifications } from "../src/modules/stream/schema.js";
import { publishToMemorySubscribers, clearMemorySubscribers } from "../src/modules/stream/subscriber.js";
import { eq, and } from "drizzle-orm";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-1111-4000-8000-000000000067";
const TENANT_B = "bbbbbbbb-2222-4000-8000-000000000067";
const USER_A = "cccccccc-3333-4000-8000-000000000067";
const USER_B = "dddddddd-4444-4000-8000-000000000067";

function token(tenantId = TENANT_A, userId = USER_A, roles = ["employee"]) {
  return signToken({ sub: userId, tid: tenantId, roles, sid: "sess-sse-001" }, SECRET);
}

beforeEach(() => {
  clearMemorySubscribers();
});

afterAll(async () => {
  clearMemorySubscribers();
  // Clean up test data
  try {
    await db.delete(notifications).where(eq(notifications.tenantId, TENANT_A));
    await db.delete(notifications).where(eq(notifications.tenantId, TENANT_B));
  } catch { /* ignore cleanup errors */ }
  await sqlClient.end();
});

/**
 * Helper: Connect to SSE endpoint and collect data for a brief period.
 * Returns the raw response data collected.
 */
function connectSSE(port: number, authToken: string, durationMs = 300): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${port}/v1/notifications/stream`,
      { headers: { authorization: `Bearer ${authToken}` } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk.toString(); });
        // SSE doesn't end naturally, so we collect for durationMs then abort
        setTimeout(() => {
          req.destroy();
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        }, durationMs);
      },
    );
    req.on("error", (err) => {
      // ECONNRESET is expected when we abort
      if ((err as NodeJS.ErrnoException).code === "ECONNRESET") return;
      reject(err);
    });
    req.setTimeout(durationMs + 1000, () => {
      req.destroy();
    });
  });
}

describe("GET /v1/notifications/stream — SSE endpoint", () => {
  it("returns 200 with SSE content-type for authenticated user", async () => {
    const app = await buildApp();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    try {
      const res = await connectSSE(port, token());
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");
    } finally {
      await app.close();
    }
  });

  it("sends connected event on initial connection", async () => {
    const app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    try {
      const res = await connectSSE(port, token());
      expect(res.body).toContain("event: connected");
      expect(res.body).toContain(`"userId":"${USER_A}"`);
      expect(res.body).toContain(`"channel":"notifications:${TENANT_A}:${USER_A}"`);
    } finally {
      await app.close();
    }
  });

  it("returns 401 without authentication token", async () => {
    const app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    try {
      const res = await new Promise<{ status: number }>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${port}/v1/notifications/stream`,
          (res) => {
            let body = "";
            res.on("data", (chunk) => { body += chunk.toString(); });
            res.on("end", () => { resolve({ status: res.statusCode ?? 0 }); });
          },
        );
        req.on("error", reject);
      });
      expect(res.status).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe("POST /v1/notifications/publish — notification persistence and pub/sub", () => {
  it("returns 202 and persists notification", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notifications/publish",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
      },
      payload: {
        userId: USER_A,
        type: "approval.assigned",
        title: "New approval request",
        body: "You have a new leave approval pending",
        metadata: { module: "hrms", entityId: "leave-123" },
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.data.id).toBeDefined();
    expect(typeof json.data.id).toBe("string");
  });

  it("returns 400 with missing required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notifications/publish",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
      },
      payload: { userId: USER_A },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without authentication", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notifications/publish",
      headers: { "content-type": "application/json" },
      payload: {
        userId: USER_A,
        type: "test",
        title: "Test",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/notifications/stream/mark-read", () => {
  it("returns 200 when marking all as read", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notifications/stream/mark-read",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
      },
      payload: { all: true },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.marked).toBeDefined();
  });

  it("returns 400 when neither notificationId nor all is provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notifications/stream/mark-read",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
      },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for non-existent notification ID", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notifications/stream/mark-read",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
      },
      payload: { notificationId: "00000000-0000-4000-8000-000000000099" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without authentication", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notifications/stream/mark-read",
      headers: { "content-type": "application/json" },
      payload: { all: true },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("Tenant isolation — notifications are scoped to tenant+user", () => {
  it("user from Tenant B cannot see Tenant A notifications on SSE connect", async () => {
    const app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    try {
      // Publish notification for User A in Tenant A
      await app.inject({
        method: "POST",
        url: "/v1/notifications/publish",
        headers: {
          authorization: `Bearer ${token(TENANT_A, USER_A)}`,
          "content-type": "application/json",
        },
        payload: {
          userId: USER_A,
          type: "test.isolation",
          title: "Tenant A notification",
        },
      });

      // Connect as User B in Tenant B — should NOT see Tenant A notifications
      const sseRes = await connectSSE(port, token(TENANT_B, USER_B));
      expect(sseRes.body).toContain("event: connected");
      expect(sseRes.body).not.toContain("Tenant A notification");
    } finally {
      await app.close();
    }
  });

  it("user within same tenant but different user ID cannot see other user notifications", async () => {
    const app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    try {
      // Publish notification for User A in Tenant A
      await app.inject({
        method: "POST",
        url: "/v1/notifications/publish",
        headers: {
          authorization: `Bearer ${token(TENANT_A, USER_A)}`,
          "content-type": "application/json",
        },
        payload: {
          userId: USER_A,
          type: "test.user-isolation",
          title: "User A only",
        },
      });

      // Connect as User B in same Tenant A — should NOT see User A's notifications
      const sseRes = await connectSSE(port, token(TENANT_A, USER_B));
      expect(sseRes.body).toContain("event: connected");
      expect(sseRes.body).not.toContain("User A only");
    } finally {
      await app.close();
    }
  });
});

describe("Offline persistence — notifications persist for offline recipients", () => {
  it("published notification appears when user connects later", async () => {
    const app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    try {
      // Publish notification (user is offline — no active SSE connection)
      const publishRes = await app.inject({
        method: "POST",
        url: "/v1/notifications/publish",
        headers: {
          authorization: `Bearer ${token(TENANT_A, USER_A)}`,
          "content-type": "application/json",
        },
        payload: {
          userId: USER_A,
          type: "workflow.task.assigned",
          title: "Pending approval: Leave request #42",
          body: "Please review the leave request from John",
          metadata: { module: "workflow", taskId: "task-42" },
        },
      });
      expect(publishRes.statusCode).toBe(202);

      // User connects later — should see the persisted notification
      const sseRes = await connectSSE(port, token(TENANT_A, USER_A));
      expect(sseRes.body).toContain("event: notification");
      expect(sseRes.body).toContain("Pending approval: Leave request #42");
      expect(sseRes.body).toContain("workflow.task.assigned");
    } finally {
      await app.close();
    }
  });

  it("marked-as-read notifications do not replay on reconnect", async () => {
    const app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    try {
      // Publish notification
      const publishRes = await app.inject({
        method: "POST",
        url: "/v1/notifications/publish",
        headers: {
          authorization: `Bearer ${token(TENANT_A, USER_A)}`,
          "content-type": "application/json",
        },
        payload: {
          userId: USER_A,
          type: "test.mark-read",
          title: "Will be marked read",
        },
      });
      const notificationId = publishRes.json().data.id;

      // Mark as read
      const markRes = await app.inject({
        method: "POST",
        url: "/v1/notifications/stream/mark-read",
        headers: {
          authorization: `Bearer ${token(TENANT_A, USER_A)}`,
          "content-type": "application/json",
        },
        payload: { notificationId },
      });
      expect(markRes.statusCode).toBe(200);

      // Reconnect — should NOT replay the read notification
      const sseRes = await connectSSE(port, token(TENANT_A, USER_A));
      expect(sseRes.body).not.toContain("Will be marked read");
    } finally {
      await app.close();
    }
  });
});

describe("Real-time message delivery via pub/sub", () => {
  it("notification published while connected is delivered via SSE", async () => {
    const app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    try {
      // Connect SSE first, then publish after a short delay
      const channel = `notifications:${TENANT_A}:${USER_A}`;
      const ssePromise = connectSSE(port, token(TENANT_A, USER_A), 500);

      const payload = JSON.stringify({
        id: "live-notif-001",
        type: "finance.bill.passed",
        title: "Bill #77 approved",
        body: "Your bill has been approved",
        metadata: {},
        createdAt: new Date().toISOString(),
      });
      // Wait until the SSE connection has actually REGISTERED as a subscriber
      // before publishing. A fixed sleep raced the connection under load: the
      // publish landed with zero subscribers and the message was simply
      // dropped, so this test flaked whenever the suite got busier.
      let delivered = 0;
      for (let attempt = 0; attempt < 100 && delivered === 0; attempt++) {
        delivered = publishToMemorySubscribers(channel, payload);
        if (delivered === 0) await new Promise((r) => setTimeout(r, 10));
      }
      expect(delivered).toBeGreaterThan(0);

      const sseRes = await ssePromise;
      expect(sseRes.body).toContain("event: connected");
      expect(sseRes.body).toContain("Bill #77 approved");
      expect(sseRes.body).toContain("finance.bill.passed");
    } finally {
      await app.close();
    }
  });
});
