/**
 * LM-001 — configurable mandatory fields on manual lead capture.
 *
 * Three things are proved here:
 *  1. `validateRequiredFields` decides missing-ness correctly on every branch;
 *  2. the configuration endpoints round-trip — a PUT that answers 202 actually
 *     leaves a row in crm.lead_field_rules once the queue has drained (an endpoint
 *     that accepts and writes nothing is the failure mode CQRS makes easy to ship);
 *  3. POST /v1/crm/contacts refuses a lead that breaks the tenant's configuration
 *     with 422, and accepts it once satisfied.
 *
 * Tenant ids are per-run (`randomUUID()`) so parallel test files and repeated runs
 * cannot see each other's configuration. messageIds are never hardcoded, so nothing
 * here poisons `_inbox.processed`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import { validateRequiredFields, isMissing } from "../src/modules/leads/field-rules-domain.js";
import {
  computeCompleteness,
  resolveWeights,
  DEFAULT_FIELD_WEIGHTS,
} from "../src/modules/leads/completeness.js";

// PII at-rest encryption fails closed without a key, and saving a lead writes
// encrypted phone/email — without this the contact consumer dead-letters and the
// 202 leaves no row, which is exactly what these tests are asserting against.
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
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-lfr" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(
  method: "GET" | "PUT" | "POST" | "DELETE",
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

/**
 * The in-memory bus captures a failed delivery to its DLQ instead of throwing, so a
 * broken consumer looks exactly like a slow one. Surfacing the reason turns "the row
 * is missing" into an actionable failure message.
 */
function dlqErrors(): string[] {
  return ((queue as unknown as { dlq?: Array<{ topic: string; error: string }> }).dlq ?? [])
    .map((d) => `${d.topic}: ${d.error}`);
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];

/** Read/write as the service does: inside a tx with the RLS GUC set. */
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

interface StoredRule {
  fieldName: string;
  required: boolean;
  weight: number;
  enabled: boolean;
  version: number;
}

/** The durability check: what is actually on disk for this tenant. */
async function rulesInDb(tenantId: string = TENANT): Promise<StoredRule[]> {
  return (await scoped(
    tenantId,
    (tx) => tx`
      SELECT field_name AS "fieldName", required, weight, enabled, version
      FROM crm.lead_field_rules
      WHERE tenant_id = ${tenantId}
      ORDER BY field_name
    `,
  )) as unknown as StoredRule[];
}

async function configure(
  body: Record<string, unknown>,
  hdrs: Record<string, string> = headers(),
) {
  return call("PUT", "/v1/crm/lead-field-rules", { headers: hdrs, payload: body });
}

async function cleanup(): Promise<void> {
  for (const tenantId of [TENANT, OTHER_TENANT]) {
    await scoped(
      tenantId,
      (tx) => tx`DELETE FROM crm.lead_field_rules WHERE tenant_id = ${tenantId}`,
    );
    await scoped(
      tenantId,
      (tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${tenantId}`,
    );
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

// ── Pure domain ─────────────────────────────────────────────────────────────────

describe("validateRequiredFields (domain)", () => {
  const full = { name: "Jane", email: "jane@example.com", phone: "+919876543210" };

  it("reports nothing when there are no rules at all", () => {
    expect(validateRequiredFields({}, [])).toEqual([]);
  });

  it("does not block a save for a rule that is required but disabled", () => {
    expect(
      validateRequiredFields({}, [{ fieldName: "phone", required: true, enabled: false }]),
    ).toEqual([]);
  });

  it("reports a required + enabled field that is absent", () => {
    expect(
      validateRequiredFields({ name: "Jane" }, [
        { fieldName: "phone", required: true, enabled: true },
      ]),
    ).toEqual(["phone"]);
  });

  it("reports nothing when a required + enabled field is present", () => {
    expect(
      validateRequiredFields(full, [{ fieldName: "phone", required: true, enabled: true }]),
    ).toEqual([]);
  });

  it("treats null as missing", () => {
    expect(
      validateRequiredFields({ phone: null }, [
        { fieldName: "phone", required: true, enabled: true },
      ]),
    ).toEqual(["phone"]);
  });

  it("treats an empty string as missing", () => {
    expect(
      validateRequiredFields({ company: "" }, [
        { fieldName: "company", required: true, enabled: true },
      ]),
    ).toEqual(["company"]);
  });

  it("treats a whitespace-only string as missing", () => {
    expect(
      validateRequiredFields({ company: "   " }, [
        { fieldName: "company", required: true, enabled: true },
      ]),
    ).toEqual(["company"]);
  });

  it("reports every missing field, in rule order", () => {
    expect(
      validateRequiredFields({ name: "Jane" }, [
        { fieldName: "phone", required: true, enabled: true },
        { fieldName: "company", required: true, enabled: true },
        { fieldName: "city", required: true, enabled: true },
      ]),
    ).toEqual(["phone", "company", "city"]);
  });

  it("does NOT report a non-required field that is absent", () => {
    expect(
      validateRequiredFields({}, [
        { fieldName: "phone", required: false, enabled: true },
        { fieldName: "company", required: true, enabled: true },
      ]),
    ).toEqual(["company"]);
  });

  it("ignores attributes with no rule governing them", () => {
    expect(validateRequiredFields({ nickname: "" }, [])).toEqual([]);
  });

  it("counts a non-string falsy value as supplied — 0 and false are answers", () => {
    expect(isMissing(0)).toBe(false);
    expect(isMissing(false)).toBe(false);
    expect(isMissing(undefined)).toBe(true);
  });
});

describe("completeness weights come from configuration (LM-001)", () => {
  it("falls back to the built-in defaults when a tenant configures nothing", () => {
    expect(resolveWeights([])).toEqual(DEFAULT_FIELD_WEIGHTS);
    // Unchanged behaviour: name + email under the default map is still 40.
    expect(computeCompleteness({ name: "Jane", email: "j@x.com" }).score).toBe(40);
  });

  it("ignores disabled and zero-weight rules, so a bare mandatory flag does not skew scoring", () => {
    expect(
      resolveWeights([
        { fieldName: "phone", weight: 0, enabled: true },
        { fieldName: "city", weight: 40, enabled: false },
      ]),
    ).toEqual(DEFAULT_FIELD_WEIGHTS);
  });

  it("scores against the configured weights when present", () => {
    const rules = [
      { fieldName: "name", weight: 50, enabled: true },
      { fieldName: "phone", weight: 50, enabled: true },
    ];
    const result = computeCompleteness({ name: "Jane" }, rules);
    expect(result.score).toBe(50);
    expect(result.totalFields).toBe(2);
    expect(result.missingFields).toEqual(["phone"]);
  });

  it("normalises a configured set whose weights do not sum to 100", () => {
    const rules = [
      { fieldName: "name", weight: 10, enabled: true },
      { fieldName: "phone", weight: 30, enabled: true },
    ];
    expect(computeCompleteness({ name: "Jane" }, rules).score).toBe(25);
    expect(computeCompleteness({ name: "Jane", phone: "1" }, rules).score).toBe(100);
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────────

describe("GET /v1/crm/lead-field-rules", () => {
  it("returns the tenant's configuration (happy path)", async () => {
    await configure({ fieldName: "phone", required: true, weight: 30 });
    const res = await call("GET", "/v1/crm/lead-field-rules");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: StoredRule[]; meta: { total: number } };
    expect(body.data.map((r) => r.fieldName)).toContain("phone");
    expect(body.meta.total).toBe(body.data.length);
  });

  it("allows a plain crm_user — the guided form needs to know which fields to star", async () => {
    const res = await call("GET", "/v1/crm/lead-field-rules", { headers: headers(["crm_user"]) });
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without a token", async () => {
    const res = await call("GET", "/v1/crm/lead-field-rules", { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await call("GET", "/v1/crm/lead-field-rules", { headers: headers(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });

  it("does not show one tenant's configuration to another", async () => {
    await configure({ fieldName: "company", required: true, weight: 20 });
    const res = await call("GET", "/v1/crm/lead-field-rules", {
      headers: headers(["crm_admin"], OTHER_TENANT),
    });
    expect(res.statusCode).toBe(200);
    const seen = (res.json() as { data: StoredRule[] }).data.map((r) => r.fieldName);
    expect(seen).not.toContain("company");
  });
});

describe("PUT /v1/crm/lead-field-rules", () => {
  it("accepts a rule and durably persists it (round-trip through the consumer)", async () => {
    const res = await configure({ fieldName: "city", required: true, weight: 15 });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");

    const stored = (await rulesInDb()).find((r) => r.fieldName === "city");
    expect(stored, "202 with no row on disk is a silent write failure").toBeDefined();
    expect(stored?.required).toBe(true);
    expect(stored?.weight).toBe(15);
    expect(stored?.enabled).toBe(true);
  });

  it("upserts rather than duplicating when the same field is configured twice", async () => {
    await configure({ fieldName: "designation", required: true, weight: 10 });
    await configure({ fieldName: "designation", required: false, weight: 25, enabled: false });

    const rows = (await rulesInDb()).filter((r) => r.fieldName === "designation");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.required).toBe(false);
    expect(rows[0]?.weight).toBe(25);
    expect(rows[0]?.enabled).toBe(false);
    expect(rows[0]?.version, "an upsert must bump the row version").toBeGreaterThan(1);
  });

  it("defaults weight to 0 and enabled to true when omitted", async () => {
    await configure({ fieldName: "country", required: true });
    const stored = (await rulesInDb()).find((r) => r.fieldName === "country");
    expect(stored?.weight).toBe(0);
    expect(stored?.enabled).toBe(true);
  });

  it("returns 400 for a field outside the configurable set", async () => {
    const res = await configure({ fieldName: "aadhaar", required: true });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when required is missing", async () => {
    const res = await configure({ fieldName: "phone" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an out-of-range weight", async () => {
    const res = await configure({ fieldName: "phone", required: true, weight: 101 });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("PUT", "/v1/crm/lead-field-rules", {
      noAuth: true,
      payload: { fieldName: "phone", required: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin CRM user — mandatory fields are governance", async () => {
    const res = await configure({ fieldName: "phone", required: true }, headers(["crm_user"]));
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/crm/lead-field-rules/:fieldName", () => {
  it("removes the rule so the field reverts to built-in behaviour", async () => {
    await configure({ fieldName: "leadSource", required: true, weight: 10 });
    expect((await rulesInDb()).some((r) => r.fieldName === "leadSource")).toBe(true);

    const res = await call("DELETE", "/v1/crm/lead-field-rules/leadSource");
    expect(res.statusCode).toBe(202);
    expect((await rulesInDb()).some((r) => r.fieldName === "leadSource")).toBe(false);
  });

  it("returns 404 when no rule is configured for that field", async () => {
    const res = await call("DELETE", "/v1/crm/lead-field-rules/email");
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 400 for a field outside the configurable set", async () => {
    const res = await call("DELETE", "/v1/crm/lead-field-rules/not-a-field");
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("DELETE", "/v1/crm/lead-field-rules/phone", { noAuth: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin CRM user", async () => {
    const res = await call("DELETE", "/v1/crm/lead-field-rules/phone", {
      headers: headers(["crm_user"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── Enforcement on manual lead capture ─────────────────────────────────────────

describe("POST /v1/crm/contacts honours the tenant's mandatory fields", () => {
  // Each case declares the whole configuration it depends on, so a rule left behind
  // by an earlier case cannot turn an expected 202 into a 422 (or hide a real one).
  beforeEach(async () => {
    for (const tenantId of [TENANT, OTHER_TENANT]) {
      await scoped(
        tenantId,
        (tx) => tx`DELETE FROM crm.lead_field_rules WHERE tenant_id = ${tenantId}`,
      );
    }
  });

  it("rejects with 422 and names the missing fields", async () => {
    await configure({ fieldName: "phone", required: true, weight: 20 });
    await configure({ fieldName: "company", required: true, weight: 20 });

    const res = await call("POST", "/v1/crm/contacts", {
      payload: { name: "Jane Prospect" },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json() as { code: string; message: string };
    expect(body.code).toBe("MANDATORY_FIELDS_MISSING");
    expect(body.message).toContain("phone");
    expect(body.message).toContain("company");
  });

  it("treats a whitespace-only value as not supplied", async () => {
    await configure({ fieldName: "phone", required: true });
    const res = await call("POST", "/v1/crm/contacts", {
      payload: { name: "Jane", phone: "   " },
    });
    expect(res.statusCode).toBe(422);
  });

  it("accepts the lead and issues an id once the configuration is satisfied", async () => {
    await configure({ fieldName: "phone", required: true, weight: 20 });
    await configure({ fieldName: "company", required: true, weight: 20 });

    const res = await call("POST", "/v1/crm/contacts", {
      payload: { name: "Jane Prospect", phone: "+919876543210", company: "Acme Corp" },
    });

    expect(res.statusCode).toBe(202);
    const accepted = res.json() as { id: string; status: string };
    expect(accepted.status).toBe("accepted");
    // The acceptance criterion: a unique Lead ID the caller can track.
    expect(accepted.id).toMatch(/^[0-9a-f-]{36}$/);

    const rows = (await scoped(
      TENANT,
      (tx) => tx`SELECT id FROM crm.contacts WHERE id = ${accepted.id} AND tenant_id = ${TENANT}`,
    )) as unknown as Array<{ id: string }>;
    expect(
      rows,
      `an accepted lead must actually be saved; dlq=${JSON.stringify(dlqErrors())}`,
    ).toHaveLength(1);
  });

  it("still accepts a name-only lead for a tenant that has configured nothing", async () => {
    const res = await call("POST", "/v1/crm/contacts", {
      headers: headers(["crm_admin"], OTHER_TENANT),
      payload: { name: "Unconfigured Tenant Lead" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("keeps the existing 400 for an invalid payload rather than reporting missing fields", async () => {
    await configure({ fieldName: "phone", required: true });
    const res = await call("POST", "/v1/crm/contacts", { payload: { name: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const res = await call("POST", "/v1/crm/contacts", {
      noAuth: true,
      payload: { name: "Jane" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role with no CRM access", async () => {
    const res = await call("POST", "/v1/crm/contacts", {
      headers: headers(["citizen"]),
      payload: { name: "Jane" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("does not enforce one tenant's rules on another tenant's lead", async () => {
    await configure({ fieldName: "phone", required: true });
    const res = await call("POST", "/v1/crm/contacts", {
      headers: headers(["crm_admin"], OTHER_TENANT),
      payload: { name: "Other Tenant Lead" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("scores the saved lead against the tenant's configured weights", async () => {
    const created = await call("POST", "/v1/crm/contacts", {
      payload: { name: "Scored Lead", phone: "+919000000000" },
    });
    expect(created.statusCode).toBe(202);
    const leadId = (created.json() as { id: string }).id;

    // required:false so this configuration governs scoring only — the point is that
    // the completeness route reads the same rules, not that it blocks anything.
    await configure({ fieldName: "name", required: false, weight: 50 });
    await configure({ fieldName: "phone", required: false, weight: 50 });

    const res = await call("GET", `/v1/crm/leads/${leadId}/completeness`);
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { score: number; totalFields: number } }).data;
    expect(data.totalFields, "only the two configured fields should count").toBe(2);
    expect(data.score).toBe(100);
  });

  it("leaves bulk import free to land partial records", async () => {
    await configure({ fieldName: "phone", required: true });
    const res = await call("POST", "/v1/crm/contacts/bulk/import", {
      payload: { contacts: [{ name: "Imported Lead" }] },
    });
    expect(res.statusCode).toBe(202);
  });
});
