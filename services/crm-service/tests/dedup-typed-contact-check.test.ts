/**
 * GAP-CRM-GRIEVANCES-NEW-01 - the backend contract the grievance form's "this phone / email already belongs
 * to a contact" warning relies on. POST /v1/crm/contacts/duplicate-check is asked with ONLY a typed phone
 * and/or email; it must (a) recognise the same subscriber however the number or address is written,
 * (b) answer { id, name, matchedFields, score 0-100 } per match - the contact NAME and nothing else about them,
 * never a phone or an email - (c) stay behind the CRM role gate and the caller's own tenant, (d) leave an audit
 * record of a typed lookup that holds the field names and the match count but not the typed value, and
 * (e) give a typed lookup a tighter rate limit than the whole-record checks (an import makes one per row).
 *
 * Pure scoring is tested directly; the route is tested with the dedup repo stubbed so the row contents are
 * under the test's control (email and phone are encrypted at rest, so a real round trip needs the PII key).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

vi.mock("../src/modules/contacts/dedup-repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/modules/contacts/dedup-repo.js")>()),
  getRules: vi.fn(),
  fetchCandidates: vi.fn(),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import * as dedupRepo from "../src/modules/contacts/dedup-repo.js";
import { DEFAULT_DEDUP_RULES, rankDuplicates, type DedupRule } from "../src/modules/contacts/dedup-domain.js";
import { DUPLICATE_LOOKUP_LIMIT_PER_MINUTE, DUPLICATE_CHECK_LIMIT_PER_MINUTE } from "../src/modules/contacts/dedup-routes.js";
// The same body the web tests parse and render: if the route's answer drifts, one side fails.
import {
  REAL_DUPLICATE_CHECK_RESPONSE,
  DUP_CHECK_REQUEST,
  DUP_CONTACT_ASHA,
  DUP_CONTACT_MEERA,
} from "../../../apps/web/src/lib/crm/testFixtures/duplicateCheckResponse";

const rules = DEFAULT_DEDUP_RULES as readonly DedupRule[];
const STORED = [
  { id: "c-phone", phone: "9876543210", email: "someone.else@example.gov.in", name: "Meera Devi" },
  { id: "c-email", phone: "9000000001", email: "Asha.Rao@Example.gov.in", name: "Asha Rao" },
  { id: "c-none", phone: "9111111111", email: "nobody@example.gov.in", name: "No Match" },
];

describe("a typed phone / email is matched however it is written", () => {
  it.each(["9876543210", "+919876543210", "+91-9876543210", "98765 43210", "09876543210", " 9876543210 "])(
    "phone %j finds the stored number",
    (typed) => {
      const hits = rankDuplicates({ phone: typed }, STORED, rules);
      expect(hits.map((h) => h.id)).toEqual(["c-phone"]);
      expect(hits[0]!.matchedFields).toEqual(["phone"]);
    },
  );

  it.each(["asha.rao@example.gov.in", "ASHA.RAO@EXAMPLE.GOV.IN", "  Asha.Rao@Example.gov.in "])("email %j finds the stored address", (typed) => {
    const hits = rankDuplicates({ email: typed }, STORED, rules);
    expect(hits.map((h) => h.id)).toEqual(["c-email"]);
    expect(hits[0]!.matchedFields).toEqual(["email"]);
  });

  it("a value nobody has finds nobody, and nothing is guessed from the name", () => {
    expect(rankDuplicates({ phone: "9222222222" }, STORED, rules)).toEqual([]);
    expect(rankDuplicates({ email: "stranger@example.gov.in" }, STORED, rules)).toEqual([]);
    expect(rankDuplicates({}, STORED, rules)).toEqual([]);
  });

  it("a match carries exactly { id, matchedFields, score } - no value of the contact", () => {
    for (const hit of [...rankDuplicates({ phone: "9876543210" }, STORED, rules), ...rankDuplicates({ email: "asha.rao@example.gov.in" }, STORED, rules)]) {
      expect(Object.keys(hit).sort()).toEqual(["id", "matchedFields", "score"]);
    }
  });

  it("honours the tenant's rules: a tenant that switched the phone rule off gets no phone match", () => {
    const noPhone = rules.map((r) => (r.field === "phone" ? { ...r, enabled: false } : r));
    expect(rankDuplicates({ phone: "9876543210" }, STORED, noPhone)).toEqual([]);
    expect(rankDuplicates({ email: "asha.rao@example.gov.in" }, STORED, noPhone).map((h) => h.id)).toEqual(["c-email"]);
  });
});

// ── the route ────────────────────────────────────────────────────────────────

const SECRET = process.env.JWT_SECRET as string; // set by vitest.config.ts
const TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[], actor = ACTOR) {
  return {
    authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

/** The tenant's contacts as the repo hands them to the route (email / phone decrypted, plus other values it must never repeat). */
const ROUTE_STORED = [
  { id: DUP_CONTACT_MEERA, name: "Meera Devi", phone: "9876543210", email: "meera.devi@example.gov.in", company: "Devi Traders", gstin: null, pan: null },
  { id: DUP_CONTACT_ASHA, name: "Asha Rao", phone: "+91 98765 43210", email: "Asha.Rao@Example.gov.in", company: "Rao and Co", gstin: null, pan: null },
  { id: "3f2a1b4c-0000-4000-8000-000000000003", name: "No Match", phone: "9111111111", email: "nobody@example.gov.in", company: null, gstin: null, pan: null },
];

const app = await buildApp();

beforeEach(() => {
  vi.mocked(dedupRepo.getRules).mockReset().mockResolvedValue([...rules]);
  vi.mocked(dedupRepo.fetchCandidates).mockReset().mockResolvedValue(ROUTE_STORED as never);
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

function check(body: unknown, opts: { roles?: string[]; actor?: string; ip?: string } = {}) {
  return app.inject({
    method: "POST",
    url: "/v1/crm/contacts/duplicate-check",
    headers: headers(opts.roles ?? ["crm_user"], opts.actor),
    payload: body as object,
    ...(opts.ip ? { remoteAddress: opts.ip } : {}),
  });
}

async function lookupAudits(actor: string): Promise<Array<{ payload: Record<string, unknown> }>> {
  return (await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return tx`SELECT payload FROM _outbox.messages
              WHERE tenant_id = ${TENANT} AND actor_id = ${actor} AND event_type = 'audit.event.record'
                AND payload->>'action' = 'contact_lookup'`;
  })) as unknown as Array<{ payload: Record<string, unknown> }>;
}

describe("POST /v1/crm/contacts/duplicate-check with only a typed phone / email", () => {
  it("answers EXACTLY the documented body: { data: [{ id, name, matchedFields, score 0-100 }] }", async () => {
    const res = await check(DUP_CHECK_REQUEST);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(REAL_DUPLICATE_CHECK_RESPONSE);
  });

  it("carries the contact NAME and nothing else about them: no email, phone, company or id number", async () => {
    const res = await check(DUP_CHECK_REQUEST);
    for (const m of res.json().data as Array<Record<string, unknown>>) {
      expect(Object.keys(m).sort()).toEqual(["id", "matchedFields", "name", "score"]);
    }
    for (const leaked of ["9876543210", "98765 43210", "meera.devi@example.gov.in", "Asha.Rao@Example.gov.in", "Devi Traders", "Rao and Co"]) {
      expect(res.body).not.toContain(leaked);
    }
  });

  it("omits `name` (rather than sending null or an empty string) for a contact that has none", async () => {
    vi.mocked(dedupRepo.fetchCandidates).mockResolvedValue([{ ...ROUTE_STORED[0]!, name: "  " }] as never);
    const res = await check({ phone: "9876543210" });
    expect(res.json().data).toEqual([{ id: DUP_CONTACT_MEERA, matchedFields: ["phone"], score: 30 }]);
  });

  it("a whole-record check (with a name) is answered the same way, so the new-contact and import screens get names too", async () => {
    const res = await check({ name: "Asha Rao", phone: "9876543210" });
    expect(res.statusCode).toBe(200);
    const asha = (res.json().data as Array<{ id: string; name?: string }>).find((m) => m.id === DUP_CONTACT_ASHA);
    expect(asha?.name).toBe("Asha Rao");
  });

  it("is tenant-scoped: the rules and the candidates are read for the CALLER's tenant only", async () => {
    await check({ phone: "9876543210" });
    expect(dedupRepo.getRules).toHaveBeenCalledWith(TENANT, ACTOR);
    expect(vi.mocked(dedupRepo.fetchCandidates).mock.calls[0]![0]).toBe(TENANT);
  });

  it.each([["crm_user"], ["crm_admin"], ["super_admin"]])("is open to the CRM role %s", async (role) => {
    expect((await check({ phone: "9876543210" }, { roles: [role] })).statusCode).toBe(200);
  });

  it.each([["citizen"], ["auditor"], ["tenant_admin"]])("is refused (403) to %s before any contact is read (the owner-decided gate is not widened)", async (role) => {
    const res = await check({ phone: "9876543210" }, { roles: [role] });
    expect(res.statusCode).toBe(403);
    expect(dedupRepo.fetchCandidates).not.toHaveBeenCalled();
  });
});

describe("a typed lookup is audited without the typed value", () => {
  it("writes ONE contact_lookup audit event: who asked, which fields, how many matched - no phone, email or hash", async () => {
    const actor = randomUUID();
    const res = await check(DUP_CHECK_REQUEST, { actor });
    expect(res.statusCode).toBe(200);
    const rows = await lookupAudits(actor);
    expect(rows).toHaveLength(1);
    const payload = rows[0]!.payload;
    expect(payload).toMatchObject({
      service: "crm",
      action: "contact_lookup",
      resourceType: "contact_registry",
      outcome: "success",
      metadata: { fields: ["phone", "email"], matchedCount: 2 },
    });
    const json = JSON.stringify(payload);
    for (const leaked of ["9876543210", "98765 43210", "asha.rao@example.gov.in", "Asha", "Meera"]) expect(json.toLowerCase()).not.toContain(leaked.toLowerCase());
    expect(json).not.toMatch(/[0-9a-f]{32,}/i); // not even a digest of the value
  });

  it("records a lookup that matched nobody too (matchedCount 0), and only the field that was typed", async () => {
    const actor = randomUUID();
    await check({ email: "stranger@example.gov.in" }, { actor });
    const rows = await lookupAudits(actor);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ metadata: { fields: ["email"], matchedCount: 0 } });
  });

  it("does not audit a whole-record check (a new-contact form, one row of an import)", async () => {
    const actor = randomUUID();
    await check({ name: "Asha Rao", phone: "9876543210" }, { actor });
    expect(await lookupAudits(actor)).toHaveLength(0);
  });

  it("does not audit a refused request", async () => {
    const actor = randomUUID();
    await check({ phone: "9876543210" }, { actor, roles: ["citizen"] });
    expect(await lookupAudits(actor)).toHaveLength(0);
  });
});

describe("rate limit: a typed lookup is tighter than a whole-record check", () => {
  // 127.0.0.1 is on the limiter allow-list, so each case uses its own address and its own actor.
  it("the budgets: 60 typed lookups a minute, the service-wide 300 for whole-record checks", () => {
    expect(DUPLICATE_LOOKUP_LIMIT_PER_MINUTE).toBe(60);
    expect(DUPLICATE_CHECK_LIMIT_PER_MINUTE).toBe(300);
  });

  it("the 61st typed lookup in a minute by one person is a 429; another person on the same address is unaffected", async () => {
    const actor = randomUUID();
    const ip = "10.50.60.1";
    for (let i = 0; i < DUPLICATE_LOOKUP_LIMIT_PER_MINUTE; i += 1) {
      const res = await check({ phone: "9876543210" }, { actor, ip });
      if (res.statusCode !== 200) throw new Error(`lookup ${i + 1} answered ${res.statusCode}`);
    }
    expect((await check({ phone: "9876543210" }, { actor, ip })).statusCode).toBe(429);
    expect((await check({ phone: "9876543210" }, { actor: randomUUID(), ip })).statusCode).toBe(200);
  });

  it("whole-record checks are NOT held to the lookup budget: an import checks one per row", async () => {
    const actor = randomUUID();
    const ip = "10.50.60.2";
    for (let i = 0; i < DUPLICATE_LOOKUP_LIMIT_PER_MINUTE + 15; i += 1) {
      const res = await check({ name: `Row ${i}`, phone: "9876543210" }, { actor, ip });
      if (res.statusCode !== 200) throw new Error(`whole-record check ${i + 1} answered ${res.statusCode}`);
    }
    // and exhausting the lookup budget does not block them, nor the reverse
    for (let i = 0; i < DUPLICATE_LOOKUP_LIMIT_PER_MINUTE; i += 1) await check({ email: "a@example.gov.in" }, { actor, ip });
    expect((await check({ email: "a@example.gov.in" }, { actor, ip })).statusCode).toBe(429);
    expect((await check({ name: "Row x", phone: "9876543210" }, { actor, ip })).statusCode).toBe(200);
  });
});
