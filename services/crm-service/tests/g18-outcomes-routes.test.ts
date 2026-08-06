/**
 * G18 — outcome capture with reason codes: ROUTE tests
 * (src/modules/outcomes/routes.ts + validators.ts + queries.ts, against real
 * Postgres and the in-process memory bus).
 *
 * Every endpoint in routes.ts is exercised for its happy path, its zod 400, 401
 * without a token, 403 with a token whose roles do not permit the operation, and
 * 404 where it takes an id — plus the two codes this module adds on top:
 * 409 on an optimistic-lock version conflict and 422 on a business-rule
 * violation.
 *
 * Three things are asserted deliberately rather than incidentally:
 *
 *  - GOVERNANCE. crm.outcome_reason_codes is scoped BY OUTCOME TYPE, so a code
 *    that applies only to `declined` must be REFUSED for a `deferred` outcome
 *    (422 REASON_CODE_NOT_APPLICABLE), and the catalogue list must narrow the
 *    same way. A canonical code is immutable to every role including
 *    super_admin.
 *  - MONEY. amountMinor is bigint minor units and travels as a decimal STRING.
 *    A value above 2^53 is written and read back through the API and asserted
 *    both on the parsed value and on the RAW response text, because a JSON
 *    number would round it and a `toBe("…")` on an already-parsed number would
 *    not notice.
 *  - CQRS. Writes return 202 and are applied by the consumer, so nothing here
 *    asserts a synchronous DB write from a route. Every mutation drains the bus
 *    and then re-reads through the API.
 *
 * TEST HYGIENE: the tenant and actor are fresh randomUUID()s, the reason-code
 * CATEGORIES are unique to this file (canonical rows are visible to every tenant
 * by design, so tenant scoping alone would not isolate them from a concurrent
 * run), and teardown deletes only rows carrying one of those ids/categories.
 * Nothing is truncated. No PII is written or asserted on — ids, codes and
 * amounts only.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { cache, queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import { PLATFORM_TENANT_ID } from "../src/modules/outcomes/schema.js";

process.env.CRM_PII_KEY ??= "test_pii_key_for_crm_domain_tests_aaaa";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

/** 2^53 + 1 — the smallest integer an IEEE-754 double cannot represent. */
const ABOVE_2_53 = 9_007_199_254_740_993n;

const TENANT = randomUUID();
const ACTOR = randomUUID();
const UNKNOWN_ID = randomUUID();

/** Subjects an outcome can be captured against — one of each supported type. */
const CONTACT_ID = randomUUID();
const DEAL_ID = randomUUID();
const NEXT_ACTION_ID = randomUUID();
const PRODUCT_ID = randomUUID();

/** Categories are unique per file: canonical rows are visible to every tenant. */
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
/** Codes asserted on by the list tests. Nothing mutates them. */
const CATEGORY = `interaction_${suffix}`;
/** Codes created and mutated by the PATCH/DELETE tests. */
const CATEGORY_MUT = `renewal_${suffix}`;
/** Holds the one canonical (platform-owned) code. */
const CATEGORY_CANON = `canon_${suffix}`;
const CANONICAL_CODE = "national_declined_reason";

let app: FastifyInstance;

// ── wire types ───────────────────────────────────────────────────────────────

interface Accepted {
  id: string;
  status: string;
  correlationId: string;
}

interface ErrorBody {
  code: string;
  message: string;
  correlationId: string;
}

interface ReasonCodeView {
  id: string;
  code: string;
  label: string;
  description: string | null;
  category: string;
  appliesTo: string[];
  governance: string;
  versionNumber: number;
  active: boolean;
  ordinal: number;
  version: number;
}

interface OutcomeView {
  id: string;
  subjectType: string;
  subjectId: string;
  outcomeRef: string;
  outcomeType: string;
  reasonCodeId: string | null;
  productId: string | null;
  amountMinor: string | null;
  currency: string | null;
  followUpNextActionId: string | null;
  occurredAt: string;
  version: number;
}

interface ListBody<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

interface SingleBody<T> {
  data: T;
}

function parse<T>(body: string): T {
  return JSON.parse(body) as T;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface CallOpts {
  roles?: string[];
  payload?: unknown;
  noAuth?: boolean;
  tenantId?: string;
}

function headers(roles: string[], tenantId: string): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-g18" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(
  method: Method,
  url: string,
  opts: CallOpts = {},
): Promise<{ statusCode: number; body: string }> {
  const res = await app.inject({
    method,
    url,
    ...(opts.noAuth ? {} : { headers: headers(opts.roles ?? ["crm_user"], opts.tenantId ?? TENANT) }),
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  });
  return { statusCode: res.statusCode, body: res.body };
}

/** POST a catalogue code, wait for the consumer, and hand back its id. */
async function createReasonCode(body: Record<string, unknown>): Promise<string> {
  const res = await call("POST", "/v1/crm/outcome-reason-codes", {
    roles: ["crm_admin"],
    payload: body,
  });
  expect(res.statusCode, `create ${String(body.code)}: ${res.body}`).toBe(202);
  await drainQueue();
  return parse<Accepted>(res.body).id;
}

/** POST an interaction outcome, wait for the consumer, and hand back its id. */
async function recordOutcome(body: Record<string, unknown>): Promise<string> {
  const res = await call("POST", "/v1/crm/interaction-outcomes", { payload: body });
  expect(res.statusCode, `record ${String(body.outcomeRef)}: ${res.body}`).toBe(202);
  await drainQueue();
  return parse<Accepted>(res.body).id;
}

async function readReasonCode(id: string): Promise<ReasonCodeView> {
  const res = await call("GET", `/v1/crm/outcome-reason-codes/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return parse<SingleBody<ReasonCodeView>>(res.body).data;
}

async function readOutcome(id: string): Promise<OutcomeView> {
  const res = await call("GET", `/v1/crm/interaction-outcomes/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return parse<SingleBody<OutcomeView>>(res.body).data;
}

// ── fixtures ─────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];

function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** The three subject kinds a route-boundary existence check has to cover. */
async function seedSubjects(): Promise<void> {
  await scoped(TENANT, async (tx) => {
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version,
        created_at, updated_at, created_by, updated_by)
      VALUES (${CONTACT_ID}, ${TENANT}, 'Outcome Subject', 'qualified', 'active', 1,
        now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`
      INSERT INTO crm.deals (id, tenant_id, name, stage, value_minor, currency, status, version,
        created_at, updated_at, created_by, updated_by)
      VALUES (${DEAL_ID}, ${TENANT}, 'Outcome Deal', 'Negotiation', 100000, 'INR', 'active', 1,
        now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`
      INSERT INTO crm.next_actions (id, tenant_id, subject_type, subject_id, action_type, due_at,
        created_at, updated_at, created_by, updated_by, version)
      VALUES (${NEXT_ACTION_ID}, ${TENANT}, 'contact', ${CONTACT_ID}, 'call',
        now() + interval '3 days', now(), now(), ${ACTOR}, ${ACTOR}, 1)
      ON CONFLICT (id) DO NOTHING
    `;
  });
}

/**
 * Canonical rows are only ever created by a seed migration, never by a command,
 * so the immutability tests seed one directly under the PLATFORM sentinel tenant.
 */
async function seedCanonicalCode(): Promise<string> {
  const id = randomUUID();
  await scoped(PLATFORM_TENANT_ID, (tx) => tx`
    INSERT INTO crm.outcome_reason_codes (id, tenant_id, code, label, category, applies_to,
      governance, version_number, active, ordinal, created_at, updated_at, created_by, updated_by, version)
    VALUES (${id}, ${PLATFORM_TENANT_ID}, ${CANONICAL_CODE}, 'National declined reason',
      ${CATEGORY_CANON}, ${JSON.stringify(["declined"])}::jsonb, 'canonical', 1, true, 0,
      now(), now(), ${ACTOR}, ${ACTOR}, 1)
    ON CONFLICT DO NOTHING
  `);
  return id;
}

async function cleanup(): Promise<void> {
  await scoped(TENANT, async (tx) => {
    await tx`DELETE FROM crm.interaction_outcomes WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.outcome_reason_codes WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.next_actions WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`;
  });
  await scoped(PLATFORM_TENANT_ID, (tx) => tx`
    DELETE FROM crm.outcome_reason_codes
    WHERE tenant_id = ${PLATFORM_TENANT_ID} AND category = ${CATEGORY_CANON}
  `);
}

// Catalogue rows the read tests assert on.
let declinedOnlyCodeId = "";
let anyTypeCodeId = "";
let retiredCodeId = "";
let canonicalCodeId = "";

// Captured outcomes the read tests assert on.
let declinedOutcomeId = "";
let convertedOutcomeId = "";
let deferredOutcomeId = "";

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  app = await buildApp();
  await cleanup();
  await seedSubjects();
  canonicalCodeId = await seedCanonicalCode();

  declinedOnlyCodeId = await createReasonCode({
    code: "moved_to_other_provider",
    label: "Moved to another provider",
    category: CATEGORY,
    appliesTo: ["declined"],
    ordinal: 1,
  });
  anyTypeCodeId = await createReasonCode({
    code: "any_outcome_reason",
    label: "Applies to any outcome",
    description: "empty appliesTo means every outcome type",
    category: CATEGORY,
    ordinal: 2,
  });
  retiredCodeId = await createReasonCode({
    code: "legacy_reason",
    label: "Retired wording",
    category: CATEGORY,
    active: false,
    ordinal: 3,
  });

  declinedOutcomeId = await recordOutcome({
    subjectType: "contact",
    subjectId: CONTACT_ID,
    outcomeRef: `call-${suffix}-1`,
    outcomeType: "declined",
    reasonCodeId: declinedOnlyCodeId,
    occurredAt: "2026-05-30T10:00:00.000Z",
  });
  convertedOutcomeId = await recordOutcome({
    subjectType: "deal",
    subjectId: DEAL_ID,
    outcomeRef: `call-${suffix}-2`,
    outcomeType: "converted",
    productId: PRODUCT_ID,
    amountMinor: ABOVE_2_53.toString(),
    // Lower case on purpose: the validator upper-cases it so one report cannot
    // contain both 'inr' and 'INR'.
    currency: "inr",
  });
  deferredOutcomeId = await recordOutcome({
    subjectType: "next_action",
    subjectId: NEXT_ACTION_ID,
    outcomeRef: `call-${suffix}-3`,
    outcomeType: "deferred",
    followUpNextActionId: NEXT_ACTION_ID,
  });
});

afterAll(async () => {
  await drainQueue();
  await app.close();
  await cleanup();
  await sqlClient.end();
});

// ══ authentication + authorisation, every endpoint ══════════════════════════

describe("auth matrix — every G18 endpoint", () => {
  /**
   * `forbidden` is a role that exists elsewhere in the platform but must not
   * reach this operation: a non-CRM role for the read/capture surface, and a
   * plain crm_user for the catalogue, which is governance rather than
   * day-to-day sales data.
   */
  function endpoints(): Array<{
    name: string;
    method: Method;
    url: string;
    forbidden: string[];
    payload?: unknown;
  }> {
    return [
      { name: "GET list codes", method: "GET", url: "/v1/crm/outcome-reason-codes", forbidden: ["hr_officer"] },
      {
        name: "GET one code",
        method: "GET",
        url: `/v1/crm/outcome-reason-codes/${declinedOnlyCodeId}`,
        forbidden: ["hr_officer"],
      },
      {
        name: "POST code",
        method: "POST",
        url: "/v1/crm/outcome-reason-codes",
        forbidden: ["crm_user"],
        payload: { code: "should_not_land", label: "x", category: CATEGORY_MUT },
      },
      {
        name: "PATCH code",
        method: "PATCH",
        url: `/v1/crm/outcome-reason-codes/${declinedOnlyCodeId}`,
        forbidden: ["crm_user"],
        payload: { label: "should not land", version: 1 },
      },
      {
        name: "DELETE code",
        method: "DELETE",
        url: `/v1/crm/outcome-reason-codes/${declinedOnlyCodeId}`,
        forbidden: ["crm_user"],
      },
      { name: "GET list outcomes", method: "GET", url: "/v1/crm/interaction-outcomes", forbidden: ["hr_officer"] },
      {
        name: "GET one outcome",
        method: "GET",
        url: `/v1/crm/interaction-outcomes/${declinedOutcomeId}`,
        forbidden: ["hr_officer"],
      },
      {
        name: "POST outcome",
        method: "POST",
        url: "/v1/crm/interaction-outcomes",
        forbidden: ["hr_officer"],
        payload: {
          subjectType: "contact",
          subjectId: CONTACT_ID,
          outcomeRef: "should-not-land",
          outcomeType: "declined",
          reasonCodeId: declinedOnlyCodeId,
        },
      },
    ];
  }

  it("401s every endpoint with no Authorization header", async () => {
    for (const e of endpoints()) {
      const res = await call(e.method, e.url, { noAuth: true, payload: e.payload });
      expect(res.statusCode, `${e.name} without a token`).toBe(401);
    }
  });

  it("403s every endpoint for a role that does not permit the operation", async () => {
    for (const e of endpoints()) {
      const res = await call(e.method, e.url, { roles: e.forbidden, payload: e.payload });
      expect(res.statusCode, `${e.name} as ${e.forbidden.join(",")}`).toBe(403);
      expect(parse<ErrorBody>(res.body).code).toBe("FORBIDDEN");
    }
  });

  it("a 403 on the catalogue really did not write anything", async () => {
    // The 403 attempts above named CATEGORY_MUT / renamed an existing code. Prove
    // the refusal happened before the command was published.
    await drainQueue();
    const res = await call("GET", `/v1/crm/outcome-reason-codes?category=${CATEGORY_MUT}&limit=200`);
    expect(res.statusCode).toBe(200);
    expect(parse<ListBody<ReasonCodeView>>(res.body).meta.total).toBe(0);
    expect((await readReasonCode(declinedOnlyCodeId)).label).toBe("Moved to another provider");
  });

  it("404s every id-bearing endpoint for an id this tenant cannot see", async () => {
    const cases: Array<{ name: string; method: Method; url: string; roles: string[]; payload?: unknown }> = [
      {
        name: "GET one code",
        method: "GET",
        url: `/v1/crm/outcome-reason-codes/${UNKNOWN_ID}`,
        roles: ["crm_user"],
      },
      {
        name: "PATCH code",
        method: "PATCH",
        url: `/v1/crm/outcome-reason-codes/${UNKNOWN_ID}`,
        roles: ["crm_admin"],
        payload: { label: "nope", version: 1 },
      },
      {
        name: "DELETE code",
        method: "DELETE",
        url: `/v1/crm/outcome-reason-codes/${UNKNOWN_ID}`,
        roles: ["crm_admin"],
      },
      {
        name: "GET one outcome",
        method: "GET",
        url: `/v1/crm/interaction-outcomes/${UNKNOWN_ID}`,
        roles: ["crm_user"],
      },
    ];
    for (const c of cases) {
      const res = await call(c.method, c.url, { roles: c.roles, payload: c.payload });
      expect(res.statusCode, `${c.name}: ${res.body}`).toBe(404);
      expect(parse<ErrorBody>(res.body).code).toBe("NOT_FOUND");
    }
  });
});

// ══ GET /v1/crm/outcome-reason-codes ════════════════════════════════════════

describe("GET /v1/crm/outcome-reason-codes", () => {
  it("200s with the standard list envelope, readable by any CRM user", async () => {
    const res = await call("GET", `/v1/crm/outcome-reason-codes?category=${CATEGORY}`);
    expect(res.statusCode).toBe(200);
    const body = parse<ListBody<ReasonCodeView>>(res.body);
    expect(body.meta).toEqual({ page: 1, pageSize: 50, total: 3 });
    expect(body.data.map((c) => c.code)).toEqual([
      "moved_to_other_provider",
      "any_outcome_reason",
      "legacy_reason",
    ]);
    expect(body.data[0]?.governance).toBe("tenant");
    expect(body.data[0]?.versionNumber).toBe(1);
  });

  it("narrows BY OUTCOME TYPE, treating an empty appliesTo as 'any type'", async () => {
    const declined = await call("GET", `/v1/crm/outcome-reason-codes?category=${CATEGORY}&outcomeType=declined`);
    expect(declined.statusCode).toBe(200);
    expect(parse<ListBody<ReasonCodeView>>(declined.body).data.map((c) => c.code).sort())
      .toEqual(["any_outcome_reason", "legacy_reason", "moved_to_other_provider"]);

    // moved_to_other_provider is scoped to `declined`, so it must NOT be offered
    // for a conversion — that scoping is the whole point of the catalogue.
    const converted = await call("GET", `/v1/crm/outcome-reason-codes?category=${CATEGORY}&outcomeType=converted`);
    expect(converted.statusCode).toBe(200);
    const codes = parse<ListBody<ReasonCodeView>>(converted.body).data.map((c) => c.code);
    expect(codes.sort()).toEqual(["any_outcome_reason", "legacy_reason"]);
    expect(codes).not.toContain("moved_to_other_provider");
  });

  it("filters on active and on governance", async () => {
    const active = await call("GET", `/v1/crm/outcome-reason-codes?category=${CATEGORY}&active=true`);
    expect(parse<ListBody<ReasonCodeView>>(active.body).meta.total).toBe(2);

    const retired = await call("GET", `/v1/crm/outcome-reason-codes?category=${CATEGORY}&active=false`);
    expect(parse<ListBody<ReasonCodeView>>(retired.body).data.map((c) => c.code)).toEqual(["legacy_reason"]);

    const tenantOwned = await call("GET", `/v1/crm/outcome-reason-codes?category=${CATEGORY}&governance=tenant`);
    expect(parse<ListBody<ReasonCodeView>>(tenantOwned.body).meta.total).toBe(3);
  });

  it("a canonical code is visible to a tenant that does not own it", async () => {
    const res = await call("GET", `/v1/crm/outcome-reason-codes?category=${CATEGORY_CANON}&governance=canonical`);
    expect(res.statusCode).toBe(200);
    const body = parse<ListBody<ReasonCodeView>>(res.body);
    expect(body.meta.total).toBe(1);
    expect(body.data[0]?.id).toBe(canonicalCodeId);
    expect(body.data[0]?.code).toBe(CANONICAL_CODE);
    expect(body.data[0]?.governance).toBe("canonical");
  });

  it("paginates on limit/offset and reports the derived page", async () => {
    const res = await call("GET", `/v1/crm/outcome-reason-codes?category=${CATEGORY}&limit=2&offset=2`);
    expect(res.statusCode).toBe(200);
    const body = parse<ListBody<ReasonCodeView>>(res.body);
    expect(body.meta).toEqual({ page: 2, pageSize: 2, total: 3 });
    expect(body.data).toHaveLength(1);
  });

  it("400s a malformed query at the zod boundary", async () => {
    for (const query of [
      "limit=0",
      "limit=201",
      "limit=abc",
      "offset=-1",
      "governance=platform",
      "outcomeType=reinvested",
      "active=yes",
      "category=Interaction",
    ]) {
      const res = await call("GET", `/v1/crm/outcome-reason-codes?${query}`);
      expect(res.statusCode, `query ${query}`).toBe(400);
      expect(parse<ErrorBody>(res.body).code).toBe("VALIDATION_FAILED");
    }
  });

  it("a tenant sees none of another tenant's codes", async () => {
    const res = await call("GET", `/v1/crm/outcome-reason-codes?category=${CATEGORY}`, {
      tenantId: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(parse<ListBody<ReasonCodeView>>(res.body).meta.total).toBe(0);
  });
});

// ══ GET /v1/crm/outcome-reason-codes/:id ════════════════════════════════════

describe("GET /v1/crm/outcome-reason-codes/:id", () => {
  it("200s with the single-entity envelope", async () => {
    const code = await readReasonCode(anyTypeCodeId);
    expect(code).toMatchObject({
      id: anyTypeCodeId,
      code: "any_outcome_reason",
      label: "Applies to any outcome",
      description: "empty appliesTo means every outcome type",
      category: CATEGORY,
      appliesTo: [],
      governance: "tenant",
      versionNumber: 1,
      active: true,
      version: 1,
    });
  });

  it("400s an id that is not a uuid", async () => {
    const res = await call("GET", "/v1/crm/outcome-reason-codes/not-a-uuid");
    expect(res.statusCode).toBe(400);
    expect(parse<ErrorBody>(res.body).code).toBe("VALIDATION_FAILED");
  });

  it("404s another tenant's code — visibility is not global", async () => {
    const res = await call("GET", `/v1/crm/outcome-reason-codes/${declinedOnlyCodeId}`, {
      tenantId: randomUUID(),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ══ POST /v1/crm/outcome-reason-codes ═══════════════════════════════════════

describe("POST /v1/crm/outcome-reason-codes", () => {
  it("202s, and the consumer applies the row at catalogue revision 1", async () => {
    const res = await call("POST", "/v1/crm/outcome-reason-codes", {
      roles: ["crm_admin"],
      payload: {
        code: "no_longer_eligible",
        label: "No longer eligible",
        category: CATEGORY_MUT,
        appliesTo: ["declined", "deferred"],
        ordinal: 7,
      },
    });
    expect(res.statusCode).toBe(202);
    const accepted = parse<Accepted>(res.body);
    expect(accepted.status).toBe("accepted");
    expect(accepted.correlationId).toBeTruthy();
    await drainQueue();

    const code = await readReasonCode(accepted.id);
    expect(code).toMatchObject({
      code: "no_longer_eligible",
      category: CATEGORY_MUT,
      appliesTo: ["declined", "deferred"],
      governance: "tenant",
      versionNumber: 1,
      ordinal: 7,
      active: true,
    });
  });

  it("re-POSTing the same (category, code) issues the NEXT revision, not an edit", async () => {
    const body = { code: "rewordable", label: "First wording", category: CATEGORY_MUT };
    const firstId = await createReasonCode(body);
    const secondId = await createReasonCode({ ...body, label: "Second wording" });

    expect(secondId).not.toBe(firstId);
    // The original wording is untouched, so outcomes captured under it still read
    // the words they were captured under.
    expect(await readReasonCode(firstId)).toMatchObject({ label: "First wording", versionNumber: 1 });
    expect(await readReasonCode(secondId)).toMatchObject({ label: "Second wording", versionNumber: 2 });
  });

  it("422s a tenant code that would shadow a canonical one", async () => {
    const res = await call("POST", "/v1/crm/outcome-reason-codes", {
      roles: ["super_admin"],
      payload: { code: CANONICAL_CODE, label: "Local override", category: CATEGORY_CANON },
    });
    expect(res.statusCode).toBe(422);
    expect(parse<ErrorBody>(res.body).code).toBe("CANONICAL_REASON_CODE_IMMUTABLE");
    await drainQueue();
    // Nothing was published: the canonical category still holds exactly one row.
    const list = await call("GET", `/v1/crm/outcome-reason-codes?category=${CATEGORY_CANON}`);
    expect(parse<ListBody<ReasonCodeView>>(list.body).meta.total).toBe(1);
  });

  it("400s a malformed body at the zod boundary", async () => {
    const bad: Array<[string, unknown]> = [
      ["missing label", { code: "some_code", category: CATEGORY_MUT }],
      ["missing code", { label: "No code", category: CATEGORY_MUT }],
      ["upper-case code", { code: "Some_Code", label: "x", category: CATEGORY_MUT }],
      ["code starting with a digit", { code: "1_code", label: "x", category: CATEGORY_MUT }],
      ["code too short", { code: "a", label: "x", category: CATEGORY_MUT }],
      ["empty label", { code: "some_code", label: "", category: CATEGORY_MUT }],
      ["category with a space", { code: "some_code", label: "x", category: "two words" }],
      ["unknown outcome type", { code: "some_code", label: "x", appliesTo: ["reinvested"] }],
      ["negative ordinal", { code: "some_code", label: "x", ordinal: -1 }],
      ["non-integer ordinal", { code: "some_code", label: "x", ordinal: 1.5 }],
      [
        "more appliesTo entries than the vocabulary has",
        { code: "some_code", label: "x", appliesTo: ["converted", "declined", "deferred", "converted"] },
      ],
    ];
    for (const [name, payload] of bad) {
      const res = await call("POST", "/v1/crm/outcome-reason-codes", { roles: ["crm_admin"], payload });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(400);
    }
  });

  it("ignores an attempt to declare a code canonical — governance is not an input", async () => {
    // `governance` is absent from the schema, so a string value is stripped rather
    // than honoured. The written row must still be tenant-owned.
    const id = await createReasonCode({
      code: "self_declared_canonical",
      label: "Trying to be canonical",
      category: CATEGORY_MUT,
      governance: "canonical",
    });
    expect((await readReasonCode(id)).governance).toBe("tenant");
  });
});

// ══ PATCH /v1/crm/outcome-reason-codes/:id ══════════════════════════════════

describe("PATCH /v1/crm/outcome-reason-codes/:id", () => {
  async function freshCode(code: string): Promise<string> {
    return createReasonCode({ code, label: "Before", category: CATEGORY_MUT });
  }

  it("202s and the consumer applies the patch, bumping the optimistic-lock version", async () => {
    const id = await freshCode(`patchable_${suffix}`);
    const res = await call("PATCH", `/v1/crm/outcome-reason-codes/${id}`, {
      roles: ["crm_admin"],
      payload: { label: "After", appliesTo: ["deferred"], ordinal: 4, version: 1 },
    });
    expect(res.statusCode).toBe(202);
    expect(parse<Accepted>(res.body).id).toBe(id);
    await drainQueue();

    expect(await readReasonCode(id)).toMatchObject({
      label: "After",
      appliesTo: ["deferred"],
      ordinal: 4,
      version: 2,
    });
  });

  it("retires a code with active=false without deleting it", async () => {
    const id = await freshCode(`retirable_${suffix}`);
    const res = await call("PATCH", `/v1/crm/outcome-reason-codes/${id}`, {
      roles: ["tenant_admin"],
      payload: { active: false, description: null, version: 1 },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect(await readReasonCode(id)).toMatchObject({ active: false, description: null, version: 2 });
  });

  it("409s a stale version rather than letting it clobber a newer write", async () => {
    const id = await freshCode(`conflicted_${suffix}`);
    const first = await call("PATCH", `/v1/crm/outcome-reason-codes/${id}`, {
      roles: ["crm_admin"],
      payload: { label: "First writer wins", version: 1 },
    });
    expect(first.statusCode).toBe(202);
    await drainQueue();

    const stale = await call("PATCH", `/v1/crm/outcome-reason-codes/${id}`, {
      roles: ["crm_admin"],
      payload: { label: "Lost update", version: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(parse<ErrorBody>(stale.body).code).toBe("VERSION_CONFLICT");
    await drainQueue();
    expect(await readReasonCode(id)).toMatchObject({ label: "First writer wins", version: 2 });
  });

  it("422s an amendment to a canonical code, for EVERY role including super_admin", async () => {
    for (const roles of [["crm_admin"], ["tenant_admin"], ["super_admin"]]) {
      const res = await call("PATCH", `/v1/crm/outcome-reason-codes/${canonicalCodeId}`, {
        roles,
        payload: { label: "Renamed nationally", version: 1 },
      });
      expect(res.statusCode, `as ${roles.join(",")}`).toBe(422);
      expect(parse<ErrorBody>(res.body).code).toBe("CANONICAL_REASON_CODE_IMMUTABLE");
    }
    await drainQueue();
    expect(await readReasonCode(canonicalCodeId)).toMatchObject({
      label: "National declined reason",
      version: 1,
    });
  });

  it("400s a malformed body at the zod boundary", async () => {
    const bad: Array<[string, unknown]> = [
      ["no mutable field", { version: 1 }],
      ["no version", { label: "x" }],
      ["version below 1", { label: "x", version: 0 }],
      ["non-integer version", { label: "x", version: 1.5 }],
      ["empty label", { label: "", version: 1 }],
      ["unknown outcome type", { appliesTo: ["reinvested"], version: 1 }],
      ["empty body", {}],
    ];
    for (const [name, payload] of bad) {
      const res = await call("PATCH", `/v1/crm/outcome-reason-codes/${declinedOnlyCodeId}`, {
        roles: ["crm_admin"],
        payload,
      });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(400);
    }
  });

  it("400s an id that is not a uuid, before it looks anything up", async () => {
    const res = await call("PATCH", "/v1/crm/outcome-reason-codes/nope", {
      roles: ["crm_admin"],
      payload: { label: "x", version: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ══ DELETE /v1/crm/outcome-reason-codes/:id ═════════════════════════════════

describe("DELETE /v1/crm/outcome-reason-codes/:id", () => {
  it("202s and the consumer soft-deletes it out of the catalogue", async () => {
    const id = await createReasonCode({ code: `deletable_${suffix}`, label: "Bye", category: CATEGORY_MUT });
    const res = await call("DELETE", `/v1/crm/outcome-reason-codes/${id}`, { roles: ["crm_admin"] });
    expect(res.statusCode).toBe(202);
    expect(parse<Accepted>(res.body).id).toBe(id);
    await drainQueue();

    // Soft-deleted rows leave the read model entirely, but the row survives so
    // outcomes already captured against it keep their FK.
    expect((await call("GET", `/v1/crm/outcome-reason-codes/${id}`)).statusCode).toBe(404);
  });

  it("422s a delete of a canonical code", async () => {
    const res = await call("DELETE", `/v1/crm/outcome-reason-codes/${canonicalCodeId}`, {
      roles: ["super_admin"],
    });
    expect(res.statusCode).toBe(422);
    expect(parse<ErrorBody>(res.body).code).toBe("CANONICAL_REASON_CODE_IMMUTABLE");
    await drainQueue();
    expect((await readReasonCode(canonicalCodeId)).active).toBe(true);
  });

  it("400s an id that is not a uuid", async () => {
    const res = await call("DELETE", "/v1/crm/outcome-reason-codes/12345", { roles: ["crm_admin"] });
    expect(res.statusCode).toBe(400);
  });
});

// ══ GET /v1/crm/interaction-outcomes ════════════════════════════════════════

describe("GET /v1/crm/interaction-outcomes", () => {
  it("200s with the standard list envelope, readable by any CRM user", async () => {
    const res = await call("GET", "/v1/crm/interaction-outcomes");
    expect(res.statusCode).toBe(200);
    const body = parse<ListBody<OutcomeView>>(res.body);
    expect(body.meta.page).toBe(1);
    expect(body.meta.pageSize).toBe(50);
    expect(body.meta.total).toBeGreaterThanOrEqual(3);
    expect(body.data.length).toBeGreaterThanOrEqual(3);
  });

  it("filters by outcomeType", async () => {
    const res = await call("GET", "/v1/crm/interaction-outcomes?outcomeType=declined");
    expect(res.statusCode).toBe(200);
    const body = parse<ListBody<OutcomeView>>(res.body);
    for (const o of body.data) {
      expect(o.outcomeType).toBe("declined");
    }
  });

  it("filters by subjectType and subjectId", async () => {
    const res = await call("GET", `/v1/crm/interaction-outcomes?subjectType=deal&subjectId=${DEAL_ID}`);
    expect(res.statusCode).toBe(200);
    const body = parse<ListBody<OutcomeView>>(res.body);
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
    for (const o of body.data) {
      expect(o.subjectType).toBe("deal");
      expect(o.subjectId).toBe(DEAL_ID);
    }
  });

  it("filters by reasonCodeId", async () => {
    const res = await call("GET", `/v1/crm/interaction-outcomes?reasonCodeId=${declinedOnlyCodeId}`);
    expect(res.statusCode).toBe(200);
    const body = parse<ListBody<OutcomeView>>(res.body);
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
    for (const o of body.data) {
      expect(o.reasonCodeId).toBe(declinedOnlyCodeId);
    }
  });

  it("paginates on limit/offset and reports the derived page", async () => {
    const res = await call("GET", "/v1/crm/interaction-outcomes?limit=1&offset=1");
    expect(res.statusCode).toBe(200);
    const body = parse<ListBody<OutcomeView>>(res.body);
    expect(body.meta).toMatchObject({ page: 2, pageSize: 1 });
    expect(body.data).toHaveLength(1);
  });

  it("400s a malformed query at the zod boundary", async () => {
    for (const query of [
      "limit=0",
      "limit=201",
      "limit=abc",
      "offset=-1",
      "outcomeType=reinvested",
      "subjectType=organisation",
      `subjectId=not-a-uuid`,
      `reasonCodeId=not-a-uuid`,
    ]) {
      const res = await call("GET", `/v1/crm/interaction-outcomes?${query}`);
      expect(res.statusCode, `query ${query}`).toBe(400);
      expect(parse<ErrorBody>(res.body).code).toBe("VALIDATION_FAILED");
    }
  });

  it("a tenant sees none of another tenant's outcomes", async () => {
    const res = await call("GET", "/v1/crm/interaction-outcomes", { tenantId: randomUUID() });
    expect(res.statusCode).toBe(200);
    expect(parse<ListBody<OutcomeView>>(res.body).meta.total).toBe(0);
  });
});

// ══ GET /v1/crm/interaction-outcomes/:id ════════════════════════════════════

describe("GET /v1/crm/interaction-outcomes/:id", () => {
  it("200s with the single-entity envelope for a declined outcome", async () => {
    const o = await readOutcome(declinedOutcomeId);
    expect(o).toMatchObject({
      id: declinedOutcomeId,
      subjectType: "contact",
      subjectId: CONTACT_ID,
      outcomeRef: `call-${suffix}-1`,
      outcomeType: "declined",
      reasonCodeId: declinedOnlyCodeId,
      productId: null,
      amountMinor: null,
      currency: null,
      followUpNextActionId: null,
      occurredAt: "2026-05-30T10:00:00.000Z",
      version: 1,
    });
  });

  it("MONEY: amountMinor above 2^53 is returned as a decimal STRING, not a JSON number", async () => {
    const o = await readOutcome(convertedOutcomeId);
    expect(o.amountMinor).toBe("9007199254740993");
    expect(o.currency).toBe("INR");
    expect(o.productId).toBe(PRODUCT_ID);

    // Prove the value is genuinely a STRING in the raw JSON — if the serializer
    // emitted a JSON number the parse would round and this assertion would fail.
    const raw = (await call("GET", `/v1/crm/interaction-outcomes/${convertedOutcomeId}`)).body;
    expect(raw).toContain('"9007199254740993"');
  });

  it("a deferred outcome carries its follow-up next action", async () => {
    const o = await readOutcome(deferredOutcomeId);
    expect(o).toMatchObject({
      subjectType: "next_action",
      subjectId: NEXT_ACTION_ID,
      outcomeType: "deferred",
      followUpNextActionId: NEXT_ACTION_ID,
    });
  });

  it("400s an id that is not a uuid", async () => {
    const res = await call("GET", "/v1/crm/interaction-outcomes/not-a-uuid");
    expect(res.statusCode).toBe(400);
    expect(parse<ErrorBody>(res.body).code).toBe("VALIDATION_FAILED");
  });

  it("404s another tenant's outcome — visibility is not global", async () => {
    const res = await call("GET", `/v1/crm/interaction-outcomes/${declinedOutcomeId}`, {
      tenantId: randomUUID(),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ══ POST /v1/crm/interaction-outcomes ═══════════════════════════════════════

describe("POST /v1/crm/interaction-outcomes", () => {
  it("202s, and the consumer writes the outcome row", async () => {
    const ref = `call-${suffix}-happy`;
    const res = await call("POST", "/v1/crm/interaction-outcomes", {
      payload: {
        subjectType: "contact",
        subjectId: CONTACT_ID,
        outcomeRef: ref,
        outcomeType: "declined",
        reasonCodeId: declinedOnlyCodeId,
      },
    });
    expect(res.statusCode).toBe(202);
    const accepted = parse<Accepted>(res.body);
    expect(accepted.status).toBe("accepted");
    expect(accepted.correlationId).toBeTruthy();
    await drainQueue();

    const o = await readOutcome(accepted.id);
    expect(o).toMatchObject({
      subjectType: "contact",
      subjectId: CONTACT_ID,
      outcomeRef: ref,
      outcomeType: "declined",
      reasonCodeId: declinedOnlyCodeId,
    });
  });

  it("converted: accepts product + amount + currency", async () => {
    const ref = `call-${suffix}-conv`;
    const id = await recordOutcome({
      subjectType: "deal",
      subjectId: DEAL_ID,
      outcomeRef: ref,
      outcomeType: "converted",
      productId: PRODUCT_ID,
      amountMinor: "500000",
      currency: "USD",
    });
    const o = await readOutcome(id);
    expect(o).toMatchObject({
      outcomeType: "converted",
      productId: PRODUCT_ID,
      amountMinor: "500000",
      currency: "USD",
    });
  });

  it("deferred: accepts follow-up next action", async () => {
    const ref = `call-${suffix}-def`;
    const id = await recordOutcome({
      subjectType: "next_action",
      subjectId: NEXT_ACTION_ID,
      outcomeRef: ref,
      outcomeType: "deferred",
      followUpNextActionId: NEXT_ACTION_ID,
    });
    const o = await readOutcome(id);
    expect(o.followUpNextActionId).toBe(NEXT_ACTION_ID);
  });

  it("upper-cases currency so both 'inr' and 'INR' cannot coexist in one report", async () => {
    const ref = `call-${suffix}-cur`;
    const id = await recordOutcome({
      subjectType: "deal",
      subjectId: DEAL_ID,
      outcomeRef: ref,
      outcomeType: "converted",
      productId: PRODUCT_ID,
      amountMinor: "100",
      currency: "inr",
    });
    expect((await readOutcome(id)).currency).toBe("INR");
  });

  it("404s when the subject does not exist in this tenant", async () => {
    const res = await call("POST", "/v1/crm/interaction-outcomes", {
      payload: {
        subjectType: "contact",
        subjectId: UNKNOWN_ID,
        outcomeRef: "ref-missing-subject",
        outcomeType: "declined",
      },
    });
    expect(res.statusCode).toBe(404);
    expect(parse<ErrorBody>(res.body).code).toBe("NOT_FOUND");
    expect(parse<ErrorBody>(res.body).message).toContain("contact");
  });

  it("404s when the reason code does not exist", async () => {
    const res = await call("POST", "/v1/crm/interaction-outcomes", {
      payload: {
        subjectType: "contact",
        subjectId: CONTACT_ID,
        outcomeRef: "ref-missing-code",
        outcomeType: "declined",
        reasonCodeId: UNKNOWN_ID,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(parse<ErrorBody>(res.body).code).toBe("NOT_FOUND");
  });

  it("404s when the follow-up next action does not exist", async () => {
    const res = await call("POST", "/v1/crm/interaction-outcomes", {
      payload: {
        subjectType: "contact",
        subjectId: CONTACT_ID,
        outcomeRef: "ref-missing-na",
        outcomeType: "deferred",
        followUpNextActionId: UNKNOWN_ID,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(parse<ErrorBody>(res.body).code).toBe("NOT_FOUND");
    expect(parse<ErrorBody>(res.body).message).toContain("next action");
  });

  it("422s when the reason code does not apply to the chosen outcome type", async () => {
    // declinedOnlyCodeId has appliesTo: ["declined"], so it must not be usable for "deferred".
    const res = await call("POST", "/v1/crm/interaction-outcomes", {
      payload: {
        subjectType: "contact",
        subjectId: CONTACT_ID,
        outcomeRef: "ref-bad-type",
        outcomeType: "deferred",
        reasonCodeId: declinedOnlyCodeId,
        followUpNextActionId: NEXT_ACTION_ID,
      },
    });
    expect(res.statusCode).toBe(422);
    expect(parse<ErrorBody>(res.body).code).toBe("REASON_CODE_NOT_APPLICABLE");
  });

  it("422s when a retired reason code is used", async () => {
    const res = await call("POST", "/v1/crm/interaction-outcomes", {
      payload: {
        subjectType: "contact",
        subjectId: CONTACT_ID,
        outcomeRef: "ref-retired-code",
        outcomeType: "declined",
        reasonCodeId: retiredCodeId,
      },
    });
    expect(res.statusCode).toBe(422);
    expect(parse<ErrorBody>(res.body).code).toBe("REASON_CODE_INACTIVE");
  });

  it("400s a malformed body at the zod boundary", async () => {
    const bad: Array<[string, unknown]> = [
      ["missing subjectType", { subjectId: CONTACT_ID, outcomeRef: "x", outcomeType: "declined" }],
      ["missing subjectId", { subjectType: "contact", outcomeRef: "x", outcomeType: "declined" }],
      ["missing outcomeRef", { subjectType: "contact", subjectId: CONTACT_ID, outcomeType: "declined" }],
      ["missing outcomeType", { subjectType: "contact", subjectId: CONTACT_ID, outcomeRef: "x" }],
      ["invalid subjectType", { subjectType: "org", subjectId: CONTACT_ID, outcomeRef: "x", outcomeType: "declined" }],
      ["invalid outcomeType", { subjectType: "contact", subjectId: CONTACT_ID, outcomeRef: "x", outcomeType: "reinvested" }],
      ["subjectId not a uuid", { subjectType: "contact", subjectId: "bad", outcomeRef: "x", outcomeType: "declined" }],
      ["reasonCodeId not a uuid", { subjectType: "contact", subjectId: CONTACT_ID, outcomeRef: "x", outcomeType: "declined", reasonCodeId: "bad" }],
      ["amountMinor negative", { subjectType: "contact", subjectId: CONTACT_ID, outcomeRef: "x", outcomeType: "converted", amountMinor: "-1" }],
      ["amountMinor decimal", { subjectType: "contact", subjectId: CONTACT_ID, outcomeRef: "x", outcomeType: "converted", amountMinor: "1.5" }],
      ["currency wrong length", { subjectType: "contact", subjectId: CONTACT_ID, outcomeRef: "x", outcomeType: "converted", amountMinor: "100", currency: "INRR" }],
      ["currency numeric", { subjectType: "contact", subjectId: CONTACT_ID, outcomeRef: "x", outcomeType: "converted", amountMinor: "100", currency: "123" }],
      ["followUpNextActionId not a uuid", { subjectType: "contact", subjectId: CONTACT_ID, outcomeRef: "x", outcomeType: "deferred", followUpNextActionId: "nope" }],
      ["outcomeRef too long", { subjectType: "contact", subjectId: CONTACT_ID, outcomeRef: "x".repeat(129), outcomeType: "declined" }],
      ["empty body", {}],
    ];
    for (const [name, payload] of bad) {
      const res = await call("POST", "/v1/crm/interaction-outcomes", { payload });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(400);
    }
  });

  it("MONEY: accepts an amount above 2^53 and the round trip is exact", async () => {
    const ref = `call-${suffix}-bigmoney`;
    const id = await recordOutcome({
      subjectType: "deal",
      subjectId: DEAL_ID,
      outcomeRef: ref,
      outcomeType: "converted",
      productId: PRODUCT_ID,
      amountMinor: ABOVE_2_53.toString(),
      currency: "INR",
    });
    const o = await readOutcome(id);
    expect(o.amountMinor).toBe("9007199254740993");
    // Prove it is a STRING, not a JSON number that the parser rounded.
    const raw = (await call("GET", `/v1/crm/interaction-outcomes/${id}`)).body;
    expect(raw).toContain('"9007199254740993"');
  });
});
