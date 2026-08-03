/**
 * P2-1 — next-best-action consent must be a SERVER-SIDE fact.
 *
 * The generate endpoint used to take `context.hasConsent` from the request body
 * and hand it straight to the eligibility gate, so any caller could assert its
 * own consent and collect consent-gated actions. These tests drive the endpoint
 * over HTTP with the CRM lookup stubbed at `fetch`, so they exercise the real
 * client (URL, internal headers, tenant, fail-closed handling) end to end.
 *
 * The first test is the regression test for the vulnerability: it sends
 * `hasConsent: true` while crm-service reports consent withdrawn.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const ATTACKER_TENANT = "aaaaaaaa-0002-4000-8000-000000000002";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const INTERNAL_SECRET = "internal_secret_for_tests_32chars";

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  listForProfileMock: vi.fn(),
  matrixListMock: vi.fn(),
  predictiveFindMock: vi.fn(),
  queuePublishMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      H.dbTransactionMock(cb),
  },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) =>
    H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
  markProcessed: vi.fn(async () => true),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKeyMock(...a),
  },
  queue: { publish: (...a: unknown[]) => H.queuePublishMock(...a) },
}));

vi.mock("../src/modules/nba/repo.js", async () => {
  const actual = await import("../src/modules/nba/repo.js");
  return {
    toView: actual.toView,
    findById: vi.fn(async () => null),
    listForProfile: (...a: unknown[]) => H.listForProfileMock(...a),
    insert: vi.fn(),
    updateStatus: vi.fn(async () => true),
  };
});

vi.mock("../src/modules/matrix/repo.js", async () => {
  const actual = await import("../src/modules/matrix/repo.js");
  return {
    toView: actual.toView,
    findById: vi.fn(async () => null),
    listByTenant: (...a: unknown[]) => H.matrixListMock(...a),
    findByProductPair: vi.fn(async () => []),
    insert: vi.fn(),
    update: vi.fn(async () => true),
    deleteById: vi.fn(async () => true),
  };
});

vi.mock("../src/modules/predictive/repo.js", async () => {
  const actual = await import("../src/modules/predictive/repo.js");
  return {
    toView: actual.toView,
    findBySubjectModel: (...a: unknown[]) => H.predictiveFindMock(...a),
    listBySubject: vi.fn(async () => []),
    listRanked: vi.fn(async () => ({ rows: [], total: 0 })),
    upsert: vi.fn(async () => []),
  };
});

import { buildApp } from "../src/app.js";

const generateUrl = "/v1/recommendations/nba/generate";

const tok = (tid: string) =>
  signToken(
    { sub: USER, tid, roles: ["recommendation_admin"], sid: "s" },
    SECRET,
  );
const auth = (tid = TENANT) => ({ authorization: `Bearer ${tok(tid)}` });

/** Consent-gated candidate — must only survive on a server-verified grant. */
const GATED = {
  id: "gated",
  actionType: "marketing_offer",
  signals: { affinity: 1 },
  eligibility: { requiresConsent: true },
};

/** Ungated candidate — must never trigger a CRM round-trip. */
const OPEN = {
  id: "open",
  actionType: "renewal_call",
  signals: { affinity: 0.5 },
};

type FetchInit = { headers?: Record<string, string>; signal?: AbortSignal };
type FetchStub = (url: string, init: FetchInit) => Promise<unknown> | unknown;

function stubCrm(handler: FetchStub) {
  const spy = vi.fn(handler as (...a: unknown[]) => unknown);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function crmJson(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function generate(
  payload: Record<string, unknown>,
  headers: Record<string, string> = auth(),
) {
  const app = await buildApp();
  try {
    return await app.inject({
      method: "POST",
      url: generateUrl,
      headers,
      payload,
    });
  } finally {
    await app.close();
  }
}

const idsOf = (res: { json: () => { data: { id: string }[] } }) =>
  res.json().data.map((a) => a.id);

let secretBefore: string | undefined;
let timeoutBefore: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(
    async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
  );
  H.cacheMakeKeyMock.mockReturnValue("cache-key");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.listForProfileMock.mockResolvedValue({ rows: [], total: 0 });
  H.matrixListMock.mockResolvedValue({ rows: [], total: 0 });
  H.predictiveFindMock.mockResolvedValue(null);
  secretBefore = process.env.INTERNAL_SERVICE_SECRET;
  timeoutBefore = process.env.CRM_CONSENT_TIMEOUT_MS;
  process.env.INTERNAL_SERVICE_SECRET = INTERNAL_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (secretBefore === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
  else process.env.INTERNAL_SERVICE_SECRET = secretBefore;
  if (timeoutBefore === undefined) delete process.env.CRM_CONSENT_TIMEOUT_MS;
  else process.env.CRM_CONSENT_TIMEOUT_MS = timeoutBefore;
});

describe("POST /v1/recommendations/nba/generate — server-side consent (P2-1)", () => {
  it("REGRESSION: a client claiming hasConsent:true gets no gated action when CRM says consent is withdrawn", async () => {
    const crm = stubCrm(() => crmJson({ marketingConsent: false }));
    const res = await generate({
      profileId: PROFILE_ID,
      context: { hasConsent: true },
      candidates: [GATED, OPEN],
    });

    expect(res.statusCode).toBe(200);
    expect(idsOf(res)).toEqual(["open"]);
    expect(res.json().meta.eligibleCount).toBe(1);
    // The verdict came from crm-service, not from the body.
    expect(crm).toHaveBeenCalledTimes(1);
  });

  it("REGRESSION: hasConsent:true cannot manufacture consent when the CRM lookup is unavailable", async () => {
    stubCrm(() => {
      throw new Error("crm-service unreachable");
    });
    const res = await generate({
      profileId: PROFILE_ID,
      context: { hasConsent: true },
      candidates: [GATED],
    });

    expect(res.statusCode).toBe(200);
    expect(idsOf(res)).toEqual([]);
  });

  it("returns the gated action when crm-service reports marketingConsent true", async () => {
    const crm = stubCrm(() => crmJson({ marketingConsent: true }));
    const res = await generate({
      profileId: PROFILE_ID,
      candidates: [GATED, OPEN],
    });

    expect(res.statusCode).toBe(200);
    expect(idsOf(res)).toEqual(["gated", "open"]);
    expect(crm).toHaveBeenCalledTimes(1);
  });

  it("returns the gated action when marketingConsent arrives nested under data", async () => {
    stubCrm(() => crmJson({ data: { marketingConsent: true } }));
    const res = await generate({ profileId: PROFILE_ID, candidates: [GATED] });
    expect(idsOf(res)).toEqual(["gated"]);
  });

  it("calls crm-service on the internal path with the tenant from the verified token", async () => {
    const crm = stubCrm(() => crmJson({ marketingConsent: true }));
    // Client also supplies a hostile x-tenant-id header; the signed tid must win.
    await generate(
      { profileId: PROFILE_ID, candidates: [GATED] },
      {
        ...auth(TENANT),
        "x-tenant-id": ATTACKER_TENANT,
        "x-correlation-id": "corr-1",
      },
    );

    expect(crm).toHaveBeenCalledTimes(1);
    const [url, init] = crm.mock.calls[0] as [string, FetchInit];
    expect(url).toContain(`/v1/crm/contacts/${PROFILE_ID}`);
    expect(init.headers?.["x-tenant-id"]).toBe(TENANT);
    expect(init.headers?.["x-tenant-id"]).not.toBe(ATTACKER_TENANT);
    expect(init.headers?.["x-internal"]).toBe("1");
    expect(init.headers?.["x-service-secret"]).toBe(INTERNAL_SECRET);
    expect(init.headers?.["x-internal-caller"]).toBe("recommendation-service");
    expect(init.headers?.["x-correlation-id"]).toBe("corr-1");
  });

  it("suppresses the gated action when crm-service reports marketingConsent false", async () => {
    stubCrm(() => crmJson({ marketingConsent: false }));
    const res = await generate({ profileId: PROFILE_ID, candidates: [GATED] });
    expect(idsOf(res)).toEqual([]);
  });

  it("suppresses the gated action when the contact is unknown to crm-service (404)", async () => {
    stubCrm(() => crmJson({ error: "not found" }, 404));
    const res = await generate({ profileId: PROFILE_ID, candidates: [GATED] });
    expect(idsOf(res)).toEqual([]);
  });

  it("suppresses the gated action when crm-service errors (500)", async () => {
    stubCrm(() => crmJson({ error: "boom" }, 500));
    const res = await generate({ profileId: PROFILE_ID, candidates: [GATED] });
    expect(idsOf(res)).toEqual([]);
  });

  it("suppresses the gated action when the response carries no marketingConsent field", async () => {
    stubCrm(() => crmJson({ id: PROFILE_ID }));
    const res = await generate({ profileId: PROFILE_ID, candidates: [GATED] });
    expect(idsOf(res)).toEqual([]);
  });

  it("suppresses the gated action when the lookup throws", async () => {
    stubCrm(() => {
      throw new Error("ECONNREFUSED");
    });
    const res = await generate({ profileId: PROFILE_ID, candidates: [GATED] });
    expect(idsOf(res)).toEqual([]);
  });

  it("suppresses the gated action when the lookup times out", async () => {
    process.env.CRM_CONSENT_TIMEOUT_MS = "5";
    const crm = stubCrm(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const res = await generate({ profileId: PROFILE_ID, candidates: [GATED] });
    expect(idsOf(res)).toEqual([]);
    expect(crm).toHaveBeenCalledTimes(1);
  });

  it("suppresses the gated action and makes no call when INTERNAL_SERVICE_SECRET is missing", async () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const crm = stubCrm(() => crmJson({ marketingConsent: true }));
    const res = await generate({ profileId: PROFILE_ID, candidates: [GATED] });
    expect(idsOf(res)).toEqual([]);
    expect(crm).not.toHaveBeenCalled();
  });

  it("makes no CRM call when no candidate requires consent", async () => {
    const crm = stubCrm(() => crmJson({ marketingConsent: true }));
    const res = await generate({
      profileId: PROFILE_ID,
      context: { hasConsent: true },
      candidates: [
        OPEN,
        { ...GATED, id: "ungated", eligibility: { requiresConsent: false } },
      ],
    });
    expect(idsOf(res).sort()).toEqual(["open", "ungated"]);
    expect(crm).not.toHaveBeenCalled();
  });

  it("makes no CRM call for matrix-built candidates, which carry no consent gate", async () => {
    const crm = stubCrm(() => crmJson({ marketingConsent: true }));
    H.matrixListMock.mockResolvedValue({
      rows: [
        {
          id: "m1",
          tenantId: TENANT,
          triggerProductId: "11111111-1111-4111-8111-111111111111",
          recommendedProductId: "22222222-2222-4222-8222-222222222222",
          segment: null,
          channel: null,
          priority: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: USER,
          updatedBy: USER,
          version: 1,
        },
      ],
      total: 1,
    });
    const res = await generate({ profileId: PROFILE_ID });
    expect(idsOf(res)).toEqual(["m1"]);
    expect(crm).not.toHaveBeenCalled();
  });

  it("performs a single CRM lookup however many candidates are gated", async () => {
    const crm = stubCrm(() => crmJson({ marketingConsent: true }));
    const res = await generate({
      profileId: PROFILE_ID,
      candidates: [
        GATED,
        { ...GATED, id: "gated-2" },
        { ...GATED, id: "gated-3" },
        OPEN,
      ],
    });
    expect(idsOf(res)).toContain("gated-2");
    expect(crm).toHaveBeenCalledTimes(1);
  });
});
