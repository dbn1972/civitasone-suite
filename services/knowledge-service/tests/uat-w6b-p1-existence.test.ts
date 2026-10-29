/**
 * UAT W6 P1 (accept-nonexistent): these knowledge command routes used to return
 * 202/200 for ANY well-formed id because they never read the target row. They now
 * do a tenant-scoped existence read first: an unknown (or another tenant's) id is
 * a 404 and nothing is published / written; a real id still gets 202 (or 200 for
 * the synchronous report) and the command still goes out.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

const bearer = (tid = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: ["knowledge_admin", "super_admin"], sid: "sess-w6b" }, SECRET, 3600)}`,
  // The gateway forwards the tenant as x-tenant-id; the tenant-tx hook uses it for the RLS GUC.
  "x-tenant-id": tid,
});

const ids = {
  faq: randomUUID(), flow: randomUUID(), category: randomUUID(), retention: randomUUID(),
  document: randomUUID(), version: randomUUID(), policy: randomUUID(),
};

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup(): Promise<void> {
  await scoped(async (tx) => {
    for (const t of ["faqs", "guided_flows", "categories", "retention_policies", "document_versions", "policy_documents"]) {
      await tx.unsafe(`DELETE FROM knowledge.${t} WHERE tenant_id = $1`, [TENANT]);
    }
  });
}

let app: FastifyInstance;
beforeAll(async () => {
  await cleanup();
  await scoped(async (tx) => {
    await tx`INSERT INTO knowledge.faqs (id, tenant_id, question, answer, created_by, updated_by)
             VALUES (${ids.faq}, ${TENANT}, 'w6b q', 'w6b a', ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO knowledge.guided_flows (id, tenant_id, title, created_by, updated_by)
             VALUES (${ids.flow}, ${TENANT}, 'w6b flow', ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO knowledge.categories (id, tenant_id, name, slug, created_by, updated_by)
             VALUES (${ids.category}, ${TENANT}, 'w6b cat', ${"w6b-" + ids.category.slice(0, 8)}, ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO knowledge.retention_policies (id, tenant_id, name, retention_years, created_by, updated_by)
             VALUES (${ids.retention}, ${TENANT}, 'w6b retention', 5, ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO knowledge.document_versions (id, tenant_id, document_id, version_no, s3_key, created_by, updated_by)
             VALUES (${ids.version}, ${TENANT}, ${ids.document}, 1, 'w6b/key', ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO knowledge.policy_documents (id, tenant_id, title, author_id, created_by, updated_by)
             VALUES (${ids.policy}, ${TENANT}, 'w6b policy', ${ACTOR}, ${ACTOR}, ${ACTOR})`;
  });
  app = await buildApp();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

type Case = { name: string; method: "PUT" | "POST"; url: (id: string) => string; real: () => string; payload: unknown; topic?: string };
const queued: Case[] = [
  { name: "PUT /v1/knowledge/categories/:id", method: "PUT", url: (id) => `/v1/knowledge/categories/${id}`, real: () => ids.category, payload: { name: "Renamed" }, topic: COMMANDS.categoryUpdate },
  { name: "PUT /v1/knowledge/retention-policies/:id", method: "PUT", url: (id) => `/v1/knowledge/retention-policies/${id}`, real: () => ids.retention, payload: { retentionYears: 7 }, topic: COMMANDS.retentionPolicyUpdate },
  { name: "POST /v1/knowledge/retention-policies/:id/apply", method: "POST", url: (id) => `/v1/knowledge/retention-policies/${id}/apply`, real: () => ids.retention, payload: {}, topic: COMMANDS.retentionPolicyApply },
  { name: "POST /v1/knowledge/documents/:documentId/versions/:versionId/restore", method: "POST", url: (id) => `/v1/knowledge/documents/${ids.document}/versions/${id}/restore`, real: () => ids.version, payload: {}, topic: COMMANDS.versionRestore },
];

describe("UAT W6 P1 — queued knowledge commands", () => {
  for (const c of queued) {
    it(`${c.name}: random id → 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: c.method, url: c.url(randomUUID()), headers: bearer(), payload: c.payload as object });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    });
    it(`${c.name}: another tenant's id → 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: c.method, url: c.url(c.real()), headers: bearer(OTHER_TENANT), payload: c.payload as object });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    });
    it(`${c.name}: real id → 202 and the command is published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: c.method, url: c.url(c.real()), headers: bearer(), payload: c.payload as object });
      expect(res.statusCode).toBe(202);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toBe(c.topic);
    });
  }

  it("restore: a real version under a DIFFERENT document → 404, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await app.inject({
      method: "POST", url: `/v1/knowledge/documents/${randomUUID()}/versions/${ids.version}/restore`,
      headers: bearer(), payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("UAT W6 P1 — synchronous knowledge writes", () => {
  it("PUT /v1/knowledge/faqs/:id: random id → 404", async () => {
    const res = await app.inject({ method: "PUT", url: `/v1/knowledge/faqs/${randomUUID()}`, headers: bearer(), payload: { answer: "x" } });
    expect(res.statusCode).toBe(404);
  });
  it("PUT /v1/knowledge/faqs/:id: real id → 202 and the row is updated", async () => {
    const res = await app.inject({ method: "PUT", url: `/v1/knowledge/faqs/${ids.faq}`, headers: bearer(), payload: { answer: "updated answer" } });
    expect(res.statusCode).toBe(202);
    const rows = await scoped((tx) => tx`SELECT answer FROM knowledge.faqs WHERE id = ${ids.faq}`) as unknown as Array<{ answer: string }>;
    expect(rows[0]?.answer).toBe("updated answer");
  });
  it("PUT /v1/knowledge/guided-flows/:id: random id → 404", async () => {
    const res = await app.inject({ method: "PUT", url: `/v1/knowledge/guided-flows/${randomUUID()}`, headers: bearer(), payload: { title: "x" } });
    expect(res.statusCode).toBe(404);
  });
  it("PUT /v1/knowledge/guided-flows/:id: real id → 202 and the row is updated", async () => {
    const res = await app.inject({ method: "PUT", url: `/v1/knowledge/guided-flows/${ids.flow}`, headers: bearer(), payload: { title: "updated flow" } });
    expect(res.statusCode).toBe(202);
    const rows = await scoped((tx) => tx`SELECT title FROM knowledge.guided_flows WHERE id = ${ids.flow}`) as unknown as Array<{ title: string }>;
    expect(rows[0]?.title).toBe("updated flow");
  });
  it("PUT /v1/knowledge/faqs/:id: another tenant's id → 404", async () => {
    const res = await app.inject({ method: "PUT", url: `/v1/knowledge/faqs/${ids.faq}`, headers: bearer(OTHER_TENANT), payload: { answer: "x" } });
    expect(res.statusCode).toBe(404);
  });
  it("POST /v1/knowledge/policies/:id/acknowledgements/report: random id → 404", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/knowledge/policies/${randomUUID()}/acknowledgements/report`, headers: bearer(), payload: {} });
    expect(res.statusCode).toBe(404);
  });
  it("POST /v1/knowledge/policies/:id/acknowledgements/report: real id → 200 report", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/knowledge/policies/${ids.policy}/acknowledgements/report`, headers: bearer(), payload: { expectedEmployeeIds: [ACTOR] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().policyId).toBe(ids.policy);
  });
});
