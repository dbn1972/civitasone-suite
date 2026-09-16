/**
 * COMP-007 -- document-service `folders` module (folder tree: create,
 * rename, move) smoke test.
 *
 * Registered as both a route AND a consumer (registerFoldersConsumers,
 * registered in worker.ts) but had zero test references anywhere in the
 * service. CQRS like this campaign's other matching-shaped modules: routes
 * publish a command through the app's own shared `queue` singleton
 * (shared/infra.ts); registering the real consumer on that SAME instance
 * (rather than a disconnected fresh queue) is what makes a route-level
 * app.inject() create observable via the module's own GET routes below.
 *
 * REAL BUG (found while writing this test, not fixed here -- see PR
 * description): this module has no local Fastify error handler (only
 * modules/files/routes.ts does, in this service), and
 * registerSchemaErrorHandler(app, HttpError) in app.ts is called AFTER
 * folderRoutes/workflowRoutes are registered (line 33 vs. lines 30-31) --
 * the identical root cause already disclosed for metadata-service's
 * config/lookups in this same tranche (see comp-007-config-smoke.test.ts in
 * that service for the full root-cause writeup: Fastify's plugin
 * encapsulation binds each route's error handler at registration time, so a
 * handler set on the parent AFTER a child route is registered never applies
 * to it). Confirmed below: a bad zod body 500s instead of 400.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { registerFoldersConsumers } from "../src/modules/folders/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function authHeaders(roles: string[], tid: string): Record<string, string> {
  const jwt = signToken({ sub: randomUUID(), tid, roles, sid: "sess-comp007-folders" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

registerFoldersConsumers(appQueue);
await appQueue.start();

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("COMP-007: folders -- POST /v1/documents/folders (create)", () => {
  it("returns 401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/documents/folders", payload: { name: "Contracts" } });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role outside the document ACL", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST", url: "/v1/documents/folders",
      headers: authHeaders(["citizen"], tid),
      payload: { name: "Contracts" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("KNOWN ISSUE (see file header): an invalid body 500s instead of 400 -- no local error handler catches the ZodError", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST", url: "/v1/documents/folders",
      headers: authHeaders(["document_user"], tid),
      payload: { name: "" }, // fails min(1)
    });
    expect(res.statusCode).toBe(500);
  });

  it("creates a real row via the queue + consumer round trip, then reads it back", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST", url: "/v1/documents/folders",
      headers: authHeaders(["document_user"], tid),
      payload: { name: "Contracts" },
    });
    expect(create.statusCode).toBe(202);
    const { id } = create.json();
    await appQueue.drain();

    const get = await app.inject({
      method: "GET", url: `/v1/documents/folders/${id}`,
      headers: authHeaders(["document_user"], tid),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().name).toBe("Contracts");
    expect(get.json().parentId).toBeNull();
  });
});

describe("COMP-007: folders -- listing, children, rename, move (all real DB, via the queue + consumer)", () => {
  it("list + children + tenant isolation, all real-DB-verified", async () => {
    const tidA = randomUUID();
    const tidB = randomUUID();
    const parent = await app.inject({
      method: "POST", url: "/v1/documents/folders",
      headers: authHeaders(["document_user"], tidA),
      payload: { name: "Parent" },
    });
    await appQueue.drain();
    const { id: parentId } = parent.json();

    const child = await app.inject({
      method: "POST", url: "/v1/documents/folders",
      headers: authHeaders(["document_user"], tidA),
      payload: { name: "Child", parentId },
    });
    await appQueue.drain();

    const list = await app.inject({ method: "GET", url: "/v1/documents/folders", headers: authHeaders(["document_user"], tidA) });
    expect(list.json().data.map((f: any) => f.name).sort()).toEqual(["Child", "Parent"]);

    const children = await app.inject({ method: "GET", url: `/v1/documents/folders/${parentId}/children`, headers: authHeaders(["document_user"], tidA) });
    expect(children.json().data).toHaveLength(1);
    expect(children.json().data[0].name).toBe("Child");

    const otherTenant = await app.inject({ method: "GET", url: "/v1/documents/folders", headers: authHeaders(["document_user"], tidB) });
    expect(otherTenant.json().data).toEqual([]);

    void child;
  });

  it("rename and move both apply via the consumer, real DB verified", async () => {
    const tid = randomUUID();
    const create = await app.inject({
      method: "POST", url: "/v1/documents/folders",
      headers: authHeaders(["document_user"], tid),
      payload: { name: "Old Name" },
    });
    await appQueue.drain();
    const { id } = create.json();

    const newParent = await app.inject({
      method: "POST", url: "/v1/documents/folders",
      headers: authHeaders(["document_user"], tid),
      payload: { name: "New Parent" },
    });
    await appQueue.drain();
    const { id: newParentId } = newParent.json();

    await app.inject({
      method: "PATCH", url: `/v1/documents/folders/${id}/rename`,
      headers: authHeaders(["document_user"], tid),
      payload: { name: "New Name" },
    });
    await app.inject({
      method: "PATCH", url: `/v1/documents/folders/${id}/move`,
      headers: authHeaders(["document_user"], tid),
      payload: { parentId: newParentId },
    });
    await appQueue.drain();

    const get = await app.inject({ method: "GET", url: `/v1/documents/folders/${id}`, headers: authHeaders(["document_user"], tid) });
    expect(get.json().name).toBe("New Name");
    expect(get.json().parentId).toBe(newParentId);
  });

  it("GET /:id 404s for a folder that doesn't exist", async () => {
    const tid = randomUUID();
    const res = await app.inject({ method: "GET", url: `/v1/documents/folders/${randomUUID()}`, headers: authHeaders(["document_user"], tid) });
    expect(res.statusCode).toBe(404);
  });
});
