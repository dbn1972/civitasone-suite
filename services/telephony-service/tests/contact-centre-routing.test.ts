/**
 * Contact-centre inbound routing regressions (DB-backed).
 *
 * Covers the defects that made inbound call handling impossible:
 *  - `telephony.did_mappings` carried a policy reading the raw `app.tenant_id`
 *    GUC, so every read on it raised a Postgres error instead of matching no
 *    rows (migration 0014 aligns it with `current_tenant_id()`).
 *  - the DID read path issued bare, non-transactional selects, so the tenant GUC
 *    was never set and FORCE RLS rejected them.
 *  - DID -> tenant resolution for a carrier webhook is pre-tenant by definition
 *    and can never be satisfied by a tenant-scoped select; it now goes through a
 *    narrowly-scoped SECURITY DEFINER lookup.
 *  - the DELETE route answered 202 for an id that does not exist, work the
 *    consumer could only ever audit as `rejected_not_found`.
 *  - IVR ordinals and the 50-hit cap were decided by the route from committed
 *    state and applied later, so batches accepted before either applied were
 *    numbered from the same base and could exceed the cap.
 *
 * Each test claims its own DID number so suites never contend over one row.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { didMappings } from "../src/modules/did/schema.js";
import { ivrHits } from "../src/modules/ivr/schema.js";
import { DEFAULT_TENANT_ID } from "../src/modules/did/domain.js";
import * as didQueries from "../src/modules/did/queries.js";
import * as didRepo from "../src/modules/did/repo.js";
import * as ivrRepo from "../src/modules/ivr/repo.js";
import { registerConsumersOnce, drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "eeeeeee1-0000-4000-8000-000000000001";
const TENANT_B = "eeeeeee2-0000-4000-8000-000000000002";
const ACTOR = "eeeeeee0-0000-4000-8000-0000000000aa";
const TENANTS = [TENANT_A, TENANT_B];

let didSeq = 0;
/** A DID number unique to one test, so tests never share a mapping row. */
function nextDid(): string {
  didSeq += 1;
  return `+9181${String(didSeq).padStart(8, "0")}`;
}

let app: FastifyInstance;

function adminToken(tenantId: string): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles: ["telephony_admin"], sid: "sess-routing" }, SECRET, 3600);
}

/** Publish a create-mapping command and wait for the consumer to apply it. */
async function createMapping(tenantId: string, didNumber: string, active = true): Promise<string> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createDidMapping, {
    messageId: id,
    type: COMMANDS.createDidMapping,
    tenantId,
    actorId: ACTOR,
    correlationId: `corr-${id}`,
    schemaVersion: "1.0",
    payload: { id, tenantId, didNumber, label: "Routing test DID", active },
  });
  await drainQueue();
  return id;
}

/** Publish an IVR batch straight onto the bus, bypassing the route's pre-check. */
async function publishHits(
  tenantId: string,
  callId: string,
  hits: Array<{ menuKey: string; digit: string; timestamp: string }>,
): Promise<void> {
  const id = randomUUID();
  await queue.publish(COMMANDS.batchIvrHits, {
    messageId: id,
    type: COMMANDS.batchIvrHits,
    tenantId,
    actorId: ACTOR,
    correlationId: `corr-${id}`,
    schemaVersion: "1.0",
    payload: { id, tenantId, callId, hits },
  });
  await drainQueue();
}

function hitBatch(count: number, offset = 0): Array<{ menuKey: string; digit: string; timestamp: string }> {
  return Array.from({ length: count }, (_, i) => ({
    menuKey: `menu_${offset + i}`,
    digit: String((offset + i) % 10),
    timestamp: new Date(Date.UTC(2024, 5, 15, 10, 0, offset + i)).toISOString(),
  }));
}

/** Does an audit outbox row exist for this resource with this outcome? */
async function auditOutcomeExists(tenantId: string, resourceId: string, outcome: string): Promise<boolean> {
  const rows = (await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return sql`
      SELECT 1 FROM _outbox.messages
      WHERE tenant_id = ${tenantId} AND event_type = 'audit.event.record'
        AND payload::text LIKE ${"%" + resourceId + "%"}
        AND payload::text LIKE ${"%" + outcome + "%"}
      LIMIT 1`;
  })) as unknown as unknown[];
  return rows.length > 0;
}

async function cleanup(): Promise<void> {
  for (const t of TENANTS) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(didMappings).where(eq(didMappings.tenantId, t));
        await tx.delete(ivrHits).where(eq(ivrHits.tenantId, t));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      }),
    );
  }
}

beforeAll(async () => {
  registerConsumersOnce();
  await cleanup();
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await cleanup();
  await sqlClient.end();
});

// ── Inbound DID → tenant resolution ───────────────────────────────

describe("inbound DID resolution", () => {
  it("resolves a dialed number to its owning tenant with no tenant context set", async () => {
    const didA = nextDid();
    const didB = nextDid();
    await createMapping(TENANT_A, didA);
    await createMapping(TENANT_B, didB);

    expect(await didQueries.resolveTenantForNumber(didA)).toBe(TENANT_A);
    expect(await didQueries.resolveTenantForNumber(didB)).toBe(TENANT_B);
  });

  it("matches a number the carrier formatted with spaces, dashes and parens", async () => {
    const did = nextDid();
    await createMapping(TENANT_A, did);
    const formatted = `(${did.slice(0, 3)}) ${did.slice(3, 6)} ${did.slice(6, 9)}-${did.slice(9)}`;
    expect(await didQueries.resolveTenantForNumber(formatted)).toBe(TENANT_A);
  });

  it("falls back to the default tenant for an unmapped number", async () => {
    expect(await didQueries.resolveTenantForNumber(nextDid())).toBe(DEFAULT_TENANT_ID);
  });

  it("falls back to the default tenant for an empty dialed number", async () => {
    expect(await didQueries.resolveTenantForNumber("")).toBe(DEFAULT_TENANT_ID);
  });

  it("does not resolve an inactive mapping", async () => {
    const did = nextDid();
    await createMapping(TENANT_B, did, false);
    expect(await didQueries.resolveTenantForNumber(did)).toBe(DEFAULT_TENANT_ID);
  });

  it("keeps the tenant-scoped read path fail-closed across tenants", async () => {
    const id = await createMapping(TENANT_A, nextDid());
    expect(await didRepo.findById(id, TENANT_A)).not.toBeNull();
    expect(await didRepo.findById(id, TENANT_B)).toBeNull();
  });
});

// ── DID mapping administration routes ─────────────────────────────

describe("DELETE /v1/telephony/did-mappings/:id", () => {
  it("returns 404 for an id that does not exist in this tenant", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/telephony/did-mappings/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken(TENANT_A)}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 404 when the mapping belongs to another tenant", async () => {
    const id = await createMapping(TENANT_A, nextDid());
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/telephony/did-mappings/${id}`,
      headers: { authorization: `Bearer ${adminToken(TENANT_B)}` },
    });
    expect(res.statusCode).toBe(404);
    expect(await didRepo.findById(id, TENANT_A)).not.toBeNull();
  });

  it("accepts a delete for an existing mapping and the consumer removes it", async () => {
    const did = nextDid();
    const id = await createMapping(TENANT_A, did);
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/telephony/did-mappings/${id}`,
      headers: { authorization: `Bearer ${adminToken(TENANT_A)}` },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect(await didRepo.findById(id, TENANT_A)).toBeNull();
    expect(await didQueries.resolveTenantForNumber(did)).toBe(DEFAULT_TENANT_ID);
  });
});

// ── IVR hit ordinals + cap, decided by the consumer ───────────────

describe("IVR hit batches applied by the consumer", () => {
  it("numbers hits contiguously across separate batches", async () => {
    const callId = randomUUID();
    await publishHits(TENANT_A, callId, hitBatch(2));
    await publishHits(TENANT_A, callId, hitBatch(1, 2));

    const hits = await ivrRepo.listByCall(TENANT_A, callId);
    expect(hits.map((h) => h.ordinal)).toEqual([1, 2, 3]);
  });

  it("rejects a batch that would exceed the per-call cap and audits the refusal", async () => {
    const callId = randomUUID();
    await publishHits(TENANT_A, callId, hitBatch(25));
    await publishHits(TENANT_A, callId, hitBatch(25, 25));
    expect(await ivrRepo.countByCall(TENANT_A, callId)).toBe(50);

    await publishHits(TENANT_A, callId, hitBatch(1, 50));

    expect(await ivrRepo.countByCall(TENANT_A, callId)).toBe(50);
    expect(await auditOutcomeExists(TENANT_A, callId, "rejected_limit_exceeded")).toBe(true);
  });

  it("keeps hits invisible to another tenant", async () => {
    const callId = randomUUID();
    await publishHits(TENANT_A, callId, hitBatch(2));
    expect(await ivrRepo.countByCall(TENANT_A, callId)).toBe(2);
    expect(await ivrRepo.countByCall(TENANT_B, callId)).toBe(0);
  });
});
