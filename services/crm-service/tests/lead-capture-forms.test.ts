/**
 * LM-002 — admin CRUD over the public lead-capture form registry.
 *
 * Every row in this table is a live credential for an UNAUTHENTICATED write endpoint
 * plus the policy that governs it, so the authz surface is tested on every verb
 * (401 / 403 / 404) rather than only on the happy path, and cross-tenant reads and
 * writes are asserted to fail.
 *
 * Tenant ids are per-run (`randomUUID()`) so parallel test files and repeated runs
 * cannot see each other's forms. messageIds are never hardcoded, so nothing here
 * poisons `_inbox.processed`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue, captureHandlers, envelope } from "./consumer-harness.js";
import { runWithTenant } from "@civitasone/db";
import { COMMANDS, EVENTS } from "../src/topics.js";
import * as formsRepo from "../src/modules/leads/capture-forms-repo.js";

// The capture consumer writes encrypted email/phone; without a key the PII layer fails
// closed, the message dead-letters and a 202 leaves no row — a failure that looks like a
// missing feature rather than missing configuration.
process.env.CRM_PII_KEY ??= "test_pii_key_for_crm_domain_tests_aaaa";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(
  roles: string[] = ["crm_admin"],
  tenantId: string = TENANT,
): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-lcf" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
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

/** Read/write as the service does: inside a tx with the RLS GUC set. */
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

interface StoredForm {
  id: string;
  formKey: string;
  name: string;
  enabled: boolean;
  requireConsent: boolean;
  allowedOrigins: string[];
  defaultLeadSource: string | null;
  campaignId: string | null;
  maxPerMinute: number;
  version: number;
}

/** The durability check: what is actually on disk for this tenant. */
async function formsInDb(tenantId: string = TENANT): Promise<StoredForm[]> {
  return (await scoped(
    tenantId,
    (tx) => tx`
      SELECT id, form_key AS "formKey", name, enabled,
             require_consent AS "requireConsent",
             allowed_origins AS "allowedOrigins",
             default_lead_source AS "defaultLeadSource",
             campaign_id AS "campaignId",
             max_per_minute AS "maxPerMinute",
             version
      FROM crm.lead_capture_forms
      WHERE tenant_id = ${tenantId}
      ORDER BY name
    `,
  )) as unknown as StoredForm[];
}

/**
 * The in-memory bus captures a failed delivery to its DLQ instead of throwing, so a
 * broken consumer looks exactly like a slow one. Surfacing the reason turns "the row is
 * missing" into an actionable failure message.
 */
function dlqErrors(): string[] {
  return ((queue as unknown as { dlq?: Array<{ topic: string; error: string }> }).dlq ?? [])
    .map((d) => `${d.topic}: ${d.error}`);
}

/**
 * Domain event topics the outbox holds for one form. Excludes the audit topic, which
 * every mutation emits — the question these assertions ask is whether a DOMAIN event was
 * emitted for a write that did or did not happen.
 */
async function outboxTopicsFor(formId: string, tenantId: string = TENANT): Promise<string[]> {
  const rows = (await scoped(
    tenantId,
    (tx) => tx`
      SELECT topic FROM _outbox.messages
      WHERE tenant_id = ${tenantId}
        AND topic <> 'audit.event.record'
        AND payload->>'formId' = ${formId}
      ORDER BY created_at
    `,
  )) as unknown as Array<{ topic: string }>;
  return rows.map((r) => r.topic);
}

async function createForm(
  body: Record<string, unknown> = { name: `form-${randomUUID().slice(0, 8)}` },
  hdrs: Record<string, string> = headers(),
) {
  return call("POST", "/v1/crm/lead-capture-forms", { headers: hdrs, payload: body });
}

async function cleanup(): Promise<void> {
  for (const tenantId of [TENANT, OTHER_TENANT]) {
    await scoped(
      tenantId,
      (tx) => tx`DELETE FROM crm.lead_capture_forms WHERE tenant_id = ${tenantId}`,
    );
    await scoped(tenantId, (tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${tenantId}`);
    await scoped(
      tenantId,
      (tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${tenantId}`,
    );
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

// ── POST ────────────────────────────────────────────────────────────────────────

describe("POST /v1/crm/lead-capture-forms", () => {
  it("registers a form, returns the server-minted key, and persists the row", async () => {
    const res = await createForm({
      name: "Contact us",
      allowedOrigins: ["https://www.example.gov.in"],
      defaultLeadSource: "website",
      maxPerMinute: 25,
    });

    expect(res.statusCode).toBe(202);
    const body = res.json() as { id: string; status: string; formKey: string };
    expect(body.status).toBe("accepted");
    // 64 lowercase hex = 256 bits. A short or guessable key would be the whole
    // security story of the public endpoint, since it is the only credential.
    expect(body.formKey).toMatch(/^[0-9a-f]{64}$/);

    const stored = (await formsInDb()).find((f) => f.name === "Contact us");
    expect(stored, `202 with no row on disk is a silent write failure; dlq=${JSON.stringify(dlqErrors())}`).toBeDefined();
    expect(stored?.formKey).toBe(body.formKey);
    expect(stored?.allowedOrigins).toEqual(["https://www.example.gov.in"]);
    expect(stored?.defaultLeadSource).toBe("website");
    expect(stored?.maxPerMinute).toBe(25);
  });

  it("defaults enabled=true and requireConsent=true — the careless config is the safe one", async () => {
    const res = await createForm({ name: "Defaults form" });
    expect(res.statusCode).toBe(202);
    const stored = (await formsInDb()).find((f) => f.name === "Defaults form");
    expect(stored?.enabled).toBe(true);
    // DPDP Act 2023: a form created without a view on consent must require it.
    expect(stored?.requireConsent).toBe(true);
    expect(stored?.maxPerMinute).toBe(10);
    expect(stored?.allowedOrigins).toEqual([]);
  });

  it("mints a distinct key per form", async () => {
    const a = await createForm({ name: `keys-a-${randomUUID().slice(0, 6)}` });
    const b = await createForm({ name: `keys-b-${randomUUID().slice(0, 6)}` });
    expect((a.json() as { formKey: string }).formKey)
      .not.toBe((b.json() as { formKey: string }).formKey);
  });

  it("returns 400 when name is missing", async () => {
    const res = await createForm({ maxPerMinute: 10 });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a client-supplied formKey — the key is never chosen by a caller", async () => {
    const res = await createForm({ name: "Sneaky", formKey: "a".repeat(64) });
    expect(res.statusCode).toBe(400);
    expect((await formsInDb()).some((f) => f.name === "Sneaky")).toBe(false);
  });

  it("returns 400 for a client-supplied tenantId", async () => {
    const res = await createForm({ name: "Cross tenant", tenantId: OTHER_TENANT });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    ["a bare hostname origin", { name: "Bad origin", allowedOrigins: ["example.gov.in"] }],
    ["a wildcard origin", { name: "Wildcard", allowedOrigins: ["*"] }],
    ["maxPerMinute below the DB CHECK", { name: "Zero", maxPerMinute: 0 }],
    ["maxPerMinute above the DB CHECK", { name: "Huge", maxPerMinute: 601 }],
    ["a non-uuid campaignId", { name: "Bad campaign", campaignId: "not-a-uuid" }],
  ])("returns 400 for %s", async (_label, payload) => {
    const res = await createForm(payload);
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("POST", "/v1/crm/lead-capture-forms", {
      noAuth: true,
      payload: { name: "No auth" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user — a form key is a credential, not a read model", async () => {
    const res = await createForm({ name: "Not allowed" }, headers(["crm_user"]));
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await createForm({ name: "Citizen" }, headers(["citizen"]));
    expect(res.statusCode).toBe(403);
  });
});

// ── GET ─────────────────────────────────────────────────────────────────────────

describe("GET /v1/crm/lead-capture-forms", () => {
  it("lists the tenant's forms with the list envelope", async () => {
    await createForm({ name: "Listed form" });
    const res = await call("GET", "/v1/crm/lead-capture-forms");
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: StoredForm[];
      meta: { page: number; pageSize: number; total: number };
    };
    expect(body.data.map((f) => f.name)).toContain("Listed form");
    expect(body.meta.total).toBe(body.data.length);
    expect(body.meta.page).toBe(1);
  });

  it("returns 401 without a token", async () => {
    const res = await call("GET", "/v1/crm/lead-capture-forms", { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user", async () => {
    const res = await call("GET", "/v1/crm/lead-capture-forms", {
      headers: headers(["crm_user"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("does not show one tenant's forms — or keys — to another", async () => {
    const created = await createForm({ name: "Tenant A only" });
    const keyA = (created.json() as { formKey: string }).formKey;

    const res = await call("GET", "/v1/crm/lead-capture-forms", {
      headers: headers(["crm_admin"], OTHER_TENANT),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: StoredForm[] };
    expect(body.data.map((f) => f.name)).not.toContain("Tenant A only");
    expect(body.data.map((f) => f.formKey)).not.toContain(keyA);
  });
});

// ── PATCH ───────────────────────────────────────────────────────────────────────

describe("PATCH /v1/crm/lead-capture-forms/:id", () => {
  async function seed(name: string): Promise<{ id: string; formKey: string }> {
    const res = await createForm({ name });
    const body = res.json() as { id: string; formKey: string };
    return { id: body.id, formKey: body.formKey };
  }

  it("amends only the supplied fields and bumps the version", async () => {
    const { id } = await seed("Patch target");
    const res = await call("PATCH", `/v1/crm/lead-capture-forms/${id}`, {
      payload: { enabled: false, requireConsent: false, maxPerMinute: 50 },
    });
    expect(res.statusCode).toBe(202);

    const stored = (await formsInDb()).find((f) => f.id === id);
    expect(stored?.enabled).toBe(false);
    expect(stored?.requireConsent).toBe(false);
    expect(stored?.maxPerMinute).toBe(50);
    // Untouched by this PATCH — a partial update must not blank the rest.
    expect(stored?.name).toBe("Patch target");
    expect(stored?.version).toBeGreaterThan(1);
  });

  it("never rotates the form key — a live URL must not silently change address", async () => {
    const { id, formKey } = await seed("Key stability");
    const res = await call("PATCH", `/v1/crm/lead-capture-forms/${id}`, {
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).toBe(202);
    expect((await formsInDb()).find((f) => f.id === id)?.formKey).toBe(formKey);
  });

  it("returns 400 for an empty patch — nothing to do is not an accepted command", async () => {
    const { id } = await seed("Empty patch");
    const res = await call("PATCH", `/v1/crm/lead-capture-forms/${id}`, { payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an unknown field", async () => {
    const { id } = await seed("Unknown field");
    const res = await call("PATCH", `/v1/crm/lead-capture-forms/${id}`, {
      payload: { formKey: "b".repeat(64) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a non-uuid id", async () => {
    const res = await call("PATCH", "/v1/crm/lead-capture-forms/not-a-uuid", {
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an id that does not exist", async () => {
    const res = await call("PATCH", `/v1/crm/lead-capture-forms/${randomUUID()}`, {
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 404 — not 202 — for another tenant's form", async () => {
    const { id } = await seed("Cross tenant patch");
    const res = await call("PATCH", `/v1/crm/lead-capture-forms/${id}`, {
      headers: headers(["crm_admin"], OTHER_TENANT),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
    // And the row is untouched.
    expect((await formsInDb()).find((f) => f.id === id)?.enabled).toBe(true);
  });

  it("returns 401 without a token", async () => {
    const res = await call("PATCH", `/v1/crm/lead-capture-forms/${randomUUID()}`, {
      noAuth: true,
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user — widening a form's policy is governance", async () => {
    const { id } = await seed("Patch authz");
    const res = await call("PATCH", `/v1/crm/lead-capture-forms/${id}`, {
      headers: headers(["crm_user"]),
      payload: { requireConsent: false },
    });
    expect(res.statusCode).toBe(403);
    expect((await formsInDb()).find((f) => f.id === id)?.requireConsent).toBe(true);
  });
});

// ── DELETE ──────────────────────────────────────────────────────────────────────

describe("DELETE /v1/crm/lead-capture-forms/:id", () => {
  it("removes the row so the public URL stops resolving", async () => {
    const created = await createForm({ name: "Delete me" });
    const { id, formKey } = created.json() as { id: string; formKey: string };

    const res = await call("DELETE", `/v1/crm/lead-capture-forms/${id}`);
    expect(res.statusCode).toBe(202);
    expect((await formsInDb()).some((f) => f.id === id)).toBe(false);

    // Hard delete, not soft: the URL must be dead, not merely filtered out of reads.
    const submit = await call("POST", `/v1/crm/public/leads/${formKey}`, {
      noAuth: true,
      payload: { name: "Too late", consent: true },
    });
    expect(submit.statusCode).toBe(404);
  });

  it("returns 400 for a non-uuid id", async () => {
    const res = await call("DELETE", "/v1/crm/lead-capture-forms/nope");
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an id that does not exist", async () => {
    const res = await call("DELETE", `/v1/crm/lead-capture-forms/${randomUUID()}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 404 — not 202 — for another tenant's form", async () => {
    const created = await createForm({ name: "Cross tenant delete" });
    const { id } = created.json() as { id: string };
    const res = await call("DELETE", `/v1/crm/lead-capture-forms/${id}`, {
      headers: headers(["crm_admin"], OTHER_TENANT),
    });
    expect(res.statusCode).toBe(404);
    expect((await formsInDb()).some((f) => f.id === id)).toBe(true);
  });

  it("returns 401 without a token", async () => {
    const res = await call("DELETE", `/v1/crm/lead-capture-forms/${randomUUID()}`, {
      noAuth: true,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user", async () => {
    const created = await createForm({ name: "Delete authz" });
    const { id } = created.json() as { id: string };
    const res = await call("DELETE", `/v1/crm/lead-capture-forms/${id}`, {
      headers: headers(["crm_user"]),
    });
    expect(res.statusCode).toBe(403);
    expect((await formsInDb()).some((f) => f.id === id)).toBe(true);
  });
});

// ── Repo details worth pinning ─────────────────────────────────────────────────

describe("capture form key generation", () => {
  it("is 64 lowercase hex characters, matching the varchar(64) column", () => {
    for (let i = 0; i < 5; i += 1) {
      expect(formsRepo.generateFormKey()).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("does not repeat", () => {
    const keys = new Set(Array.from({ length: 50 }, () => formsRepo.generateFormKey()));
    expect(keys.size).toBe(50);
  });
});

// ── Consumer guards the routes cannot reach ────────────────────────────────────

describe("capture form consumer guards", () => {
  const { handlerFor } = captureHandlers();

  it("does not emit an update event for a form that vanished after the route's 404 check", async () => {
    const messageId = randomUUID();
    const formId = randomUUID();
    const msg = envelope(
      COMMANDS.updateLeadCaptureForm,
      { id: formId, tenantId: TENANT, changed: { enabled: false }, updatedBy: ACTOR },
      { tenantId: TENANT, actorId: ACTOR, messageId },
    );

    // The guarded UPDATE matches nothing. That must be a quiet no-op, not a throw that
    // dead-letters, and not an event describing a form that no longer exists.
    await expect(
      runWithTenant(TENANT, () => handlerFor(COMMANDS.updateLeadCaptureForm)(msg)),
    ).resolves.toBeUndefined();
    expect(await outboxTopicsFor(formId)).toEqual([]);

    await scoped(TENANT, (tx) => tx`DELETE FROM _inbox.processed WHERE message_id = ${messageId}`);
  });

  it("treats deleting an already-deleted form as a no-op", async () => {
    const messageId = randomUUID();
    const formId = randomUUID();
    const msg = envelope(
      COMMANDS.deleteLeadCaptureForm,
      { id: formId, tenantId: TENANT },
      { tenantId: TENANT, actorId: ACTOR, messageId },
    );

    await expect(
      runWithTenant(TENANT, () => handlerFor(COMMANDS.deleteLeadCaptureForm)(msg)),
    ).resolves.toBeUndefined();
    expect(await outboxTopicsFor(formId)).toEqual([]);

    await scoped(TENANT, (tx) => tx`DELETE FROM _inbox.processed WHERE message_id = ${messageId}`);
  });

  it("applies a redelivered create exactly once", async () => {
    const messageId = randomUUID();
    const formId = randomUUID();
    const msg = envelope(
      COMMANDS.createLeadCaptureForm,
      {
        id: formId,
        tenantId: TENANT,
        formKey: formsRepo.generateFormKey(),
        name: "Redelivered form",
        enabled: true,
        requireConsent: true,
        allowedOrigins: [],
        maxPerMinute: 10,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      },
      { tenantId: TENANT, actorId: ACTOR, messageId },
    );

    await runWithTenant(TENANT, () => handlerFor(COMMANDS.createLeadCaptureForm)(msg));
    await runWithTenant(TENANT, () => handlerFor(COMMANDS.createLeadCaptureForm)(msg));

    expect((await formsInDb()).filter((f) => f.id === formId)).toHaveLength(1);
    // One create event, not two: `markProcessed` short-circuits the replay.
    expect(await outboxTopicsFor(formId)).toEqual([EVENTS.leadCaptureFormCreated]);

    await scoped(TENANT, (tx) => tx`DELETE FROM _inbox.processed WHERE message_id = ${messageId}`);
  });
});
