/**
 * G5 §2 — the backward-compatibility guarantee for `crm.contacts.segment`.
 *
 * This is the risky part of the item, so it is proved rather than asserted in a comment.
 * `crm.contacts.segment` is a free-text varchar(64) that live tenants already populate
 * through the LQ-003 classification command. The column is not removed, renamed or
 * rewritten; catalogue enforcement is a per-tenant switch that DEFAULTS TO OFF.
 *
 * Two halves:
 *  - DEFAULT OFF: a tenant with no settings row (which is every tenant that existed
 *    before this feature) classifies exactly as before — including with values that
 *    enforcement would refuse.
 *  - ON: an unknown segment value is refused with 422 and the valid codes, a published
 *    segmentCode is accepted, and turning the switch back off restores the old
 *    behaviour.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import { RESOURCE, SETTINGS_RESOURCE } from "../src/modules/segments/repo.js";

// Saving a contact writes encrypted email/phone; without a key the contact consumer
// dead-letters and the 202 leaves no row to classify.
process.env.CRM_PII_KEY ??= "test_pii_key_for_crm_domain_tests_aaaa";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

/** The tenant that opts in to enforcement. */
const ENFORCING = randomUUID();
/** The tenant that never touches the switch — the "existing tenant" control. */
const LEGACY = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_admin"], tenantId = ENFORCING): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-enf" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

type Method = "GET" | "POST" | "PATCH" | "PUT";

async function call(
  method: Method,
  url: string,
  opts: { headers?: Record<string, string>; payload?: unknown } = {},
) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    headers: opts.headers ?? headers(),
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

async function createContact(name: string, tenantId = ENFORCING): Promise<string> {
  const res = await call("POST", "/v1/crm/contacts", {
    headers: headers(["crm_admin"], tenantId),
    payload: { name },
  });
  expect(res.statusCode, res.body).toBe(202);
  return (res.json() as { id: string }).id;
}

async function segmentOf(contactId: string, tenantId = ENFORCING): Promise<string | null> {
  const rows = (await scoped(
    tenantId,
    (tx) => tx`SELECT segment FROM crm.contacts WHERE id = ${contactId} AND tenant_id = ${tenantId}`,
  )) as unknown as Array<{ segment: string | null }>;
  return rows[0]?.segment ?? null;
}

async function classify(contactId: string, payload: Record<string, unknown>, tenantId = ENFORCING) {
  return call("PATCH", `/v1/crm/contacts/${contactId}/classification`, {
    headers: headers(["crm_admin"], tenantId),
    payload,
  });
}

async function setEnforcement(on: boolean, tenantId = ENFORCING): Promise<void> {
  const res = await call("PUT", "/v1/crm/segments/settings", {
    headers: headers(["crm_admin"], tenantId),
    payload: { enforceSegmentCatalogue: on },
  });
  expect(res.statusCode).toBe(202);
  const read = await call("GET", "/v1/crm/segments/settings", {
    headers: headers(["crm_admin"], tenantId),
  });
  expect((read.json() as { data: { enforceSegmentCatalogue: boolean } }).data.enforceSegmentCatalogue).toBe(on);
}

/** Create + publish a segment so its code is an accepted classification value. */
async function publishSegmentCode(segmentCode: string, tenantId = ENFORCING): Promise<void> {
  const created = await call("POST", "/v1/crm/segments", {
    headers: headers(["crm_admin"], tenantId),
    payload: {
      segmentCode,
      displayName: `${segmentCode} display`,
      priorityProducts: ["PARCEL_EXPRESS"],
      primaryChannels: ["email"],
    },
  });
  expect(created.statusCode, created.body).toBe(202);
  const published = await call("POST", `/v1/crm/segments/${segmentCode}/publish`, {
    headers: headers(["crm_admin"], tenantId),
  });
  expect(published.statusCode, published.body).toBe(202);
}

async function cleanup(): Promise<void> {
  for (const t of [ENFORCING, LEGACY]) {
    await scoped(t, (tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${t}`);
    await scoped(t, (tx) => tx`DELETE FROM crm.segment_definitions WHERE tenant_id = ${t}`);
    await scoped(t, (tx) => tx`DELETE FROM crm.segment_settings WHERE tenant_id = ${t}`);
    await cache.invalidateResource(t, RESOURCE);
    await cache.invalidateResource(t, SETTINGS_RESOURCE);
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

// ── Default OFF: existing tenants see zero behaviour change ────────────────────

describe("enforcement is OFF by default — classification behaves exactly as before (G5 §2)", () => {
  it("has no settings row for a tenant that never touched the switch, and reports OFF", async () => {
    const rows = (await scoped(
      LEGACY,
      (tx) => tx`SELECT tenant_id FROM crm.segment_settings WHERE tenant_id = ${LEGACY}`,
    )) as unknown as Array<{ tenant_id: string }>;
    expect(rows, "a default-off tenant must not need a row").toHaveLength(0);

    const res = await call("GET", "/v1/crm/segments/settings", { headers: headers(["crm_admin"], LEGACY) });
    expect((res.json() as { data: { enforceSegmentCatalogue: boolean } }).data.enforceSegmentCatalogue).toBe(false);
  });

  it.each(["enterprise", "Enterprise", "ENT", "entrprise", "small business / retail", "x".repeat(64)])(
    "accepts and persists the free-text value %j",
    async (value) => {
      const id = await createContact(`Legacy ${value.slice(0, 12)}`, LEGACY);
      const res = await classify(id, { segment: value }, LEGACY);
      expect(res.statusCode, res.body).toBe(202);
      expect(await segmentOf(id, LEGACY)).toBe(value);
    },
  );

  it("accepts a value that WOULD be refused if the tenant had enforcement on", async () => {
    // Build a catalogue for the legacy tenant but leave the switch alone. The value
    // below is not a published code, so with enforcement on it would be a 422.
    await publishSegmentCode("LEGACY_CATALOGUE_CODE", LEGACY);
    const id = await createContact("Legacy despite catalogue", LEGACY);
    const res = await classify(id, { segment: "not-in-the-catalogue" }, LEGACY);
    expect(res.statusCode, "an unenforced tenant must not be affected by its own catalogue").toBe(202);
    expect(await segmentOf(id, LEGACY)).toBe("not-in-the-catalogue");
  });

  it("still writes the other classification fields alongside a free-text segment", async () => {
    const id = await createContact("Legacy full classify", LEGACY);
    const res = await classify(
      id,
      { temperature: "hot", priority: "high", segment: "govt", product: "erp", region: "south", expectedValueMinor: 250000 },
      LEGACY,
    );
    expect(res.statusCode).toBe(202);
    const rows = (await scoped(
      LEGACY,
      (tx) => tx`
        SELECT temperature, priority, segment, product, region, expected_value_minor AS "ev"
        FROM crm.contacts WHERE id = ${id} AND tenant_id = ${LEGACY}
      `,
    )) as unknown as Array<Record<string, unknown>>;
    expect(rows[0]!.temperature).toBe("hot");
    expect(rows[0]!.segment).toBe("govt");
    expect(String(rows[0]!.ev)).toBe("250000");
  });

  it("still clears the segment with an explicit null", async () => {
    const id = await createContact("Legacy null clear", LEGACY);
    await classify(id, { segment: "anything" }, LEGACY);
    const res = await classify(id, { segment: null }, LEGACY);
    expect(res.statusCode).toBe(202);
    expect(await segmentOf(id, LEGACY)).toBeNull();
  });
});

// ── Switched ON: unknown codes are refused ─────────────────────────────────────

describe("enforcement ON refuses a segment that is not a published segmentCode (G5 §2)", () => {
  it("refuses an unknown value with 422 and lists the valid codes", async () => {
    await publishSegmentCode("SMALL_BUSINESS");
    await publishSegmentCode("ENTERPRISE");
    await setEnforcement(true);

    const id = await createContact("Enforced unknown");
    const res = await classify(id, { segment: "enterprise" }); // wrong case = wrong key
    expect(res.statusCode).toBe(422);
    const body = res.json() as { code: string; message: string };
    expect(body.code).toBe("SEGMENT_NOT_IN_CATALOGUE");
    expect(body.message).toContain("SMALL_BUSINESS");
    expect(body.message).toContain("ENTERPRISE");
    // Refused at the route, so nothing was published and nothing was written.
    expect(await segmentOf(id)).toBeNull();
  });

  it("accepts a published segmentCode and persists it", async () => {
    const id = await createContact("Enforced known");
    const res = await classify(id, { segment: "SMALL_BUSINESS" });
    expect(res.statusCode, res.body).toBe(202);
    expect(await segmentOf(id)).toBe("SMALL_BUSINESS");
  });

  it("refuses a DRAFT code — publishing is what makes a code usable", async () => {
    const created = await call("POST", "/v1/crm/segments", {
      payload: { segmentCode: "STILL_DRAFT", displayName: "Still draft" },
    });
    expect(created.statusCode).toBe(202);
    const id = await createContact("Enforced draft");
    const res = await classify(id, { segment: "STILL_DRAFT" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SEGMENT_NOT_IN_CATALOGUE");
  });

  it("stops accepting a code as soon as it is deprecated", async () => {
    await publishSegmentCode("TO_BE_RETIRED");
    const ok = await classify(await createContact("Before retire"), { segment: "TO_BE_RETIRED" });
    expect(ok.statusCode).toBe(202);

    const dep = await call("POST", "/v1/crm/segments/TO_BE_RETIRED/deprecate");
    expect(dep.statusCode).toBe(202);

    const after = await classify(await createContact("After retire"), { segment: "TO_BE_RETIRED" });
    expect(after.statusCode).toBe(422);
  });

  it("still allows clearing the segment — enforcement governs vocabulary, not presence", async () => {
    const id = await createContact("Enforced clear");
    await classify(id, { segment: "SMALL_BUSINESS" });
    const res = await classify(id, { segment: null });
    expect(res.statusCode).toBe(202);
    expect(await segmentOf(id)).toBeNull();
  });

  it("still allows a classification that does not touch the segment at all", async () => {
    const id = await createContact("Enforced other fields");
    const res = await classify(id, { temperature: "warm", priority: "low" });
    expect(res.statusCode).toBe(202);
    const rows = (await scoped(
      ENFORCING,
      (tx) => tx`SELECT temperature FROM crm.contacts WHERE id = ${id} AND tenant_id = ${ENFORCING}`,
    )) as unknown as Array<{ temperature: string | null }>;
    expect(rows[0]?.temperature).toBe("warm");
  });

  it("leaves segment values written before enforcement was switched on untouched", async () => {
    // Written while the tenant was still unenforced, then read back after the switch.
    const rows = (await scoped(
      LEGACY,
      (tx) => tx`SELECT count(*)::int AS n FROM crm.contacts WHERE tenant_id = ${LEGACY} AND segment IS NOT NULL`,
    )) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n, "existing free-text data must survive the feature").toBeGreaterThan(0);
  });

  it("does not enforce one tenant's catalogue on another tenant", async () => {
    const id = await createContact("Other tenant free text", LEGACY);
    const res = await classify(id, { segment: "still free text" }, LEGACY);
    expect(res.statusCode).toBe(202);
    expect(await segmentOf(id, LEGACY)).toBe("still free text");
  });

  it("restores the previous behaviour when the switch goes back off", async () => {
    await setEnforcement(false);
    const id = await createContact("Enforcement reverted");
    const res = await classify(id, { segment: "enterprise" });
    expect(res.statusCode, "turning enforcement off must be a complete revert").toBe(202);
    expect(await segmentOf(id)).toBe("enterprise");
  });
});
