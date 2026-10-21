/**
 * GAP-CRM-LEAD-FORMS-01 -- rotate a public lead-capture form's key.
 *
 * POST /v1/crm/lead-capture-forms/:id/rotate-key replaces the form's bearer key IN
 * PLACE: same form id (so the attribution stamped on already-captured leads stays
 * attached), new unguessable key, old key dead the moment the command applies. The
 * write and its audit event commit in one transaction and neither key ever reaches
 * the outbox. DB-backed; tenant ids are per-run so nothing collides.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue, captureHandlers, envelope } from "./consumer-harness.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import * as formsRepo from "../src/modules/leads/capture-forms-repo.js";

// Set by vitest.config.ts (env.JWT_SECRET); no literal secret in the source.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_admin"], tenantId: string = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-lcf-rot" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(
  method: "GET" | "POST",
  url: string,
  opts: { headers?: Record<string, string>; payload?: unknown; noAuth?: boolean } = {},
) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    ...(opts.noAuth ? {} : { headers: opts.headers ?? headers() }),
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

interface Stored { id: string; formKey: string; version: number; name: string; requireConsent: boolean; allowedOrigins: string[]; maxPerMinute: number }
async function formRow(id: string, tenantId: string = TENANT): Promise<Stored | undefined> {
  const rows = (await scoped(tenantId, (tx) => tx`
    SELECT id, form_key AS "formKey", version, name, require_consent AS "requireConsent",
           allowed_origins AS "allowedOrigins", max_per_minute AS "maxPerMinute"
    FROM crm.lead_capture_forms WHERE tenant_id = ${tenantId} AND id = ${id}
  `)) as unknown as Stored[];
  return rows[0];
}

async function createForm(name: string, tenantId: string = TENANT): Promise<{ id: string; formKey: string }> {
  const res = await call("POST", "/v1/crm/lead-capture-forms", {
    headers: headers(["crm_admin"], tenantId),
    payload: { name, allowedOrigins: ["https://www.example.gov.in"], maxPerMinute: 25 },
  });
  expect(res.statusCode).toBe(202);
  return res.json() as { id: string; formKey: string };
}

async function outboxFor(formId: string, tenantId: string = TENANT) {
  return (await scoped(tenantId, (tx) => tx`
    SELECT topic, payload FROM _outbox.messages
    WHERE tenant_id = ${tenantId}
      AND (payload->>'formId' = ${formId} OR payload->>'resourceId' = ${formId})
    ORDER BY created_at
  `)) as unknown as Array<{ topic: string; payload: Record<string, unknown> }>;
}

async function cleanup(): Promise<void> {
  for (const tenantId of [TENANT, OTHER_TENANT]) {
    await scoped(tenantId, (tx) => tx`DELETE FROM crm.lead_capture_forms WHERE tenant_id = ${tenantId}`);
    await scoped(tenantId, (tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${tenantId}`);
    await cache.invalidateResource(tenantId, formsRepo.RESOURCE);
  }
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("POST /v1/crm/lead-capture-forms/:id/rotate-key", () => {
  it("returns a new 64-hex key, replaces the stored key in place, and keeps id, policy and bumps version", async () => {
    const form = await createForm("Rotate me");
    const before = await formRow(form.id);
    expect(before?.formKey).toBe(form.formKey);

    const res = await call("POST", `/v1/crm/lead-capture-forms/${form.id}/rotate-key`);
    expect(res.statusCode).toBe(202);
    const body = res.json() as { id: string; status: string; formKey: string };
    expect(body.id).toBe(form.id);
    expect(body.formKey).toMatch(/^[0-9a-f]{64}$/);
    expect(body.formKey).not.toBe(form.formKey);

    const after = await formRow(form.id);
    expect(after?.formKey).toBe(body.formKey);
    expect(after?.version).toBe((before?.version ?? 0) + 1);
    // Policy untouched: rotation changes the credential, nothing else.
    expect(after?.name).toBe("Rotate me");
    expect(after?.requireConsent).toBe(true);
    expect(after?.allowedOrigins).toEqual(["https://www.example.gov.in"]);
    expect(after?.maxPerMinute).toBe(25);
  });

  it("kills the old key at once and resolves the new one on the anonymous path", async () => {
    const form = await createForm("Old key dies");
    const res = await call("POST", `/v1/crm/lead-capture-forms/${form.id}/rotate-key`);
    const { formKey: newKey } = res.json() as { formKey: string };

    expect(await formsRepo.findByFormKey(form.formKey)).toBeNull();
    expect((await formsRepo.findByFormKey(newKey))?.id).toBe(form.id);
  });

  it("is audited, and neither the old nor the new key reaches the outbox", async () => {
    const form = await createForm("Audited rotate");
    const res = await call("POST", `/v1/crm/lead-capture-forms/${form.id}/rotate-key`);
    const { formKey: newKey } = res.json() as { formKey: string };

    const rows = await outboxFor(form.id);
    const audit = rows.find((r) => r.topic === "audit.event.record" && r.payload.action === "rotate_key");
    expect(audit, JSON.stringify(rows)).toBeDefined();
    expect(audit?.payload.resourceId).toBe(form.id);
    const updated = rows.find((r) => r.topic === EVENTS.leadCaptureFormUpdated);
    expect(updated?.payload.changed).toEqual({ keyRotated: true });
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain(form.formKey);
    expect(blob).not.toContain(newKey);
  });

  it("401 without a token, 403 for a plain crm_user (key unchanged), 404 for an unknown id", async () => {
    const form = await createForm("Authz rotate");
    const url = `/v1/crm/lead-capture-forms/${form.id}/rotate-key`;
    expect((await call("POST", url, { noAuth: true })).statusCode).toBe(401);
    expect((await call("POST", url, { headers: headers(["crm_user"]) })).statusCode).toBe(403);
    expect((await formRow(form.id))?.formKey).toBe(form.formKey);
    expect((await call("POST", `/v1/crm/lead-capture-forms/${randomUUID()}/rotate-key`)).statusCode).toBe(404);
  });

  it("cannot rotate another tenant's form (404, key unchanged)", async () => {
    const foreign = await createForm("Foreign form", OTHER_TENANT);
    const res = await call("POST", `/v1/crm/lead-capture-forms/${foreign.id}/rotate-key`, { headers: headers(["crm_admin"], TENANT) });
    expect(res.statusCode).toBe(404);
    expect((await formRow(foreign.id, OTHER_TENANT))?.formKey).toBe(foreign.formKey);
  });

  it("rejects a malformed id with 400", async () => {
    const res = await call("POST", "/v1/crm/lead-capture-forms/not-a-uuid/rotate-key");
    expect(res.statusCode).toBe(400);
  });
});

describe("rotate-key consumer guards", () => {
  const { handlerFor } = captureHandlers();

  it("applies a redelivered rotation exactly once", async () => {
    const form = await createForm("Redelivered rotate");
    const messageId = randomUUID();
    const newKey = formsRepo.generateFormKey();
    const msg = envelope(
      COMMANDS.rotateLeadCaptureFormKey,
      { id: form.id, tenantId: TENANT, formKey: newKey, updatedBy: ACTOR },
      { tenantId: TENANT, actorId: ACTOR, messageId },
    );
    await runWithTenant(TENANT, () => handlerFor(COMMANDS.rotateLeadCaptureFormKey)(msg));
    await runWithTenant(TENANT, () => handlerFor(COMMANDS.rotateLeadCaptureFormKey)(msg));

    const stored = await formRow(form.id);
    expect(stored?.formKey).toBe(newKey);
    // One rotation => version 2 (create=1), not 3; and a single audit row.
    expect(stored?.version).toBe(2);
    const audits = (await outboxFor(form.id)).filter((r) => r.payload.action === "rotate_key");
    expect(audits).toHaveLength(1);
    await scoped(TENANT, (tx) => tx`DELETE FROM _inbox.processed WHERE message_id = ${messageId}`);
  });

  it("is a quiet no-op, with no event or audit, when the form vanished after the route accepted", async () => {
    const messageId = randomUUID();
    const formId = randomUUID();
    const msg = envelope(
      COMMANDS.rotateLeadCaptureFormKey,
      { id: formId, tenantId: TENANT, formKey: formsRepo.generateFormKey(), updatedBy: ACTOR },
      { tenantId: TENANT, actorId: ACTOR, messageId },
    );
    await expect(
      runWithTenant(TENANT, () => handlerFor(COMMANDS.rotateLeadCaptureFormKey)(msg)),
    ).resolves.toBeUndefined();
    expect(await outboxFor(formId)).toEqual([]);
    await scoped(TENANT, (tx) => tx`DELETE FROM _inbox.processed WHERE message_id = ${messageId}`);
  });
});
