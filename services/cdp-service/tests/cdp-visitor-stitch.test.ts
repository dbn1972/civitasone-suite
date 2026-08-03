/**
 * CR-CDP-04 — anonymous → known visitor merge.
 * Unit coverage of the stitch validation, survivorship plan, lineage entry and
 * deterministic identifier resolution, plus route coverage for track/list/stitch
 * (happy path + 400/401/403/404/409/422).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  ANONYMOUS_PROFILE_TYPE,
  VISITOR_STATUSES,
  SHELL_ONLY_ATTRIBUTES,
  validateStitch,
  buildStitchLineageEntry,
  planStitch,
  resolveKnownProfile,
} from "../src/modules/identity/stitch-domain.js";
import { hashIdentifier } from "../src/modules/identity/domain.js";
import type { ProfileRow } from "../src/modules/profiles/schema.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const OTHER_TENANT = "aaaaaaaa-0009-4000-8000-000000000009";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const VISITOR_ID = "eeeeeeee-1111-4000-8000-000000000001";
const ANON_PROFILE = "bbbbbbbb-3333-4000-8000-000000000001";
const KNOWN_PROFILE = "bbbbbbbb-4444-4000-8000-000000000001";
const VISITOR_KEY = "cookie-abc-123456";

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: ANON_PROFILE,
    tenantId: TENANT,
    profileType: ANONYMOUS_PROFILE_TYPE,
    attributes: {},
    sourceLineage: [],
    mergedFromIds: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...overrides,
  };
}

const anon = (o: Partial<ProfileRow> = {}): ProfileRow => profile(o);
const known = (o: Partial<ProfileRow> = {}): ProfileRow =>
  profile({ id: KNOWN_PROFILE, profileType: "individual", ...o });

// ── PURE: validateStitch ──────────────────────────────────────────────────────

describe("validateStitch", () => {
  it("accepts an anonymous shell joining a known individual", () => {
    expect(validateStitch({ visitorStatus: "anonymous", anonymous: anon(), known: known() })).toBeNull();
  });

  it("exposes the two documented visitor statuses", () => {
    expect([...VISITOR_STATUSES]).toEqual(["anonymous", "merged"]);
  });

  it("refuses a visitor that was already stitched", () => {
    expect(validateStitch({ visitorStatus: "merged", anonymous: anon(), known: known() }))
      .toBe("visitor has already been stitched");
  });

  it("refuses stitching a profile into itself", () => {
    expect(validateStitch({ visitorStatus: "anonymous", anonymous: anon(), known: known({ id: ANON_PROFILE, profileType: "individual" }) }))
      .toBe("cannot stitch a visitor into its own anonymous profile");
  });

  it("refuses a cross-tenant stitch", () => {
    expect(validateStitch({ visitorStatus: "anonymous", anonymous: anon(), known: known({ tenantId: OTHER_TENANT }) }))
      .toBe("cannot stitch profiles from different tenants");
  });

  it("refuses an already-merged anonymous profile", () => {
    expect(validateStitch({ visitorStatus: "anonymous", anonymous: anon({ profileType: "merged" }), known: known() }))
      .toBe("anonymous profile has already been merged");
  });

  it("refuses an already-merged target", () => {
    expect(validateStitch({ visitorStatus: "anonymous", anonymous: anon(), known: known({ profileType: "merged" }) }))
      .toBe("target profile has already been merged");
  });

  it("refuses joining two anonymous shells", () => {
    expect(validateStitch({ visitorStatus: "anonymous", anonymous: anon(), known: known({ profileType: ANONYMOUS_PROFILE_TYPE }) }))
      .toBe("target profile is itself an anonymous visitor shell");
  });
});

// ── PURE: buildStitchLineageEntry ─────────────────────────────────────────────

describe("buildStitchLineageEntry", () => {
  const hash = hashIdentifier("visitorId", VISITOR_KEY);

  it("records the source and an ISO timestamp", () => {
    const e = buildStitchLineageEntry(hash, new Date("2026-02-03T04:05:06.000Z"));
    expect(e.source).toBe("anonymous_stitch");
    expect(e.timestamp).toBe("2026-02-03T04:05:06.000Z");
  });

  it("truncates the visitor hash to 12 characters", () => {
    const e = buildStitchLineageEntry(hash, new Date());
    expect(e.sourceId).toBe(`visitor:${hash.slice(0, 12)}`);
    expect(e.sourceId).not.toContain(hash);
  });

  it("never contains the raw visitor key", () => {
    const e = buildStitchLineageEntry(hash, new Date());
    expect(e.sourceId).not.toContain(VISITOR_KEY);
  });
});

// ── PURE: planStitch ──────────────────────────────────────────────────────────

describe("planStitch", () => {
  const at = new Date("2026-02-03T04:05:06.000Z");
  const hash = hashIdentifier("visitorId", VISITOR_KEY);

  it("names the known profile as the winner", () => {
    const plan = planStitch(anon(), known(), hash, at);
    expect(plan.winnerId).toBe(KNOWN_PROFILE);
    expect(plan.loserId).toBe(ANON_PROFILE);
  });

  it("keeps the known value when both sides disagree", () => {
    const plan = planStitch(
      anon({ attributes: { city: "Guessed", anonymous: true } }),
      known({ attributes: { city: "Asserted" } }),
      hash, at,
    );
    expect(plan.attributes.city).toBe("Asserted");
  });

  it("lets anonymous data fill a gap the known profile left empty", () => {
    const plan = planStitch(
      anon({ attributes: { city: "Pune", anonymous: true } }),
      known({ attributes: { city: "", name: "Rajesh" } }),
      hash, at,
    );
    expect(plan.attributes.city).toBe("Pune");
    expect(plan.attributes.name).toBe("Rajesh");
  });

  it("strips the shell's own bookkeeping keys", () => {
    const plan = planStitch(
      anon({ attributes: { anonymous: true, visitorKeyHash: hash, mergedInto: "x", city: "Pune" } }),
      known({ attributes: {} }),
      hash, at,
    );
    for (const key of SHELL_ONLY_ATTRIBUTES) {
      expect(plan.attributes[key]).toBeUndefined();
    }
    expect(plan.attributes.city).toBe("Pune");
  });

  it("keeps a shell-named key the known profile asserted itself", () => {
    const plan = planStitch(
      anon({ attributes: { anonymous: true } }),
      known({ attributes: { anonymous: false } }),
      hash, at,
    );
    expect(plan.attributes.anonymous).toBe(false);
  });

  it("unions both lineages and appends the stitch entry last", () => {
    const plan = planStitch(
      anon({ sourceLineage: [{ source: "anonymous_visitor", sourceId: "v-1", timestamp: "2026-01-01T00:00:00.000Z" }] }),
      known({ sourceLineage: [{ source: "crm", sourceId: "c-1", timestamp: "2025-01-01T00:00:00.000Z" }] }),
      hash, at,
    );
    expect(plan.sourceLineage.map((e) => e.source)).toEqual(["crm", "anonymous_visitor", "anonymous_stitch"]);
    expect(plan.sourceLineage.at(-1)).toEqual(plan.lineageEntry);
  });

  it("does not duplicate a lineage entry both sides already share", () => {
    const shared = { source: "crm", sourceId: "c-1", timestamp: "2025-01-01T00:00:00.000Z" };
    const plan = planStitch(anon({ sourceLineage: [shared] }), known({ sourceLineage: [shared] }), hash, at);
    expect(plan.sourceLineage).toHaveLength(2);
  });
});

// ── PURE: resolveKnownProfile ─────────────────────────────────────────────────

describe("resolveKnownProfile", () => {
  it("resolves a single match", () => {
    expect(resolveKnownProfile([KNOWN_PROFILE])).toEqual({ status: "resolved", profileId: KNOWN_PROFILE });
  });

  it("resolves repeated hits on the same profile", () => {
    expect(resolveKnownProfile([KNOWN_PROFILE, KNOWN_PROFILE]))
      .toEqual({ status: "resolved", profileId: KNOWN_PROFILE });
  });

  it("reports no match on an empty list", () => {
    expect(resolveKnownProfile([])).toEqual({ status: "none" });
  });

  it("refuses a split match instead of guessing", () => {
    const r = resolveKnownProfile(["p-2", "p-1"]);
    expect(r.status).toBe("ambiguous");
    // Sorted, so the steward sees the same pair regardless of lookup order.
    expect(r).toEqual({ status: "ambiguous", profileIds: ["p-1", "p-2"] });
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  visitorFindByIdMock: vi.fn(),
  visitorFindByHashMock: vi.fn(),
  visitorListMock: vi.fn(),
  visitorInsertMock: vi.fn(),
  visitorTouchMock: vi.fn(),
  visitorMarkMergedMock: vi.fn(),
  profileFindByIdMock: vi.fn(),
  profileInsertMock: vi.fn(),
  profileMarkMergedMock: vi.fn(),
  identityInsertMock: vi.fn(),
  identityFindByHashMock: vi.fn(),
  identityReassignMock: vi.fn(),
  deviceReassignMock: vi.fn(),
  eventsReassignMock: vi.fn(),
  nameKeyDeleteMock: vi.fn(),
  enqueueMock: vi.fn(),
  publishMock: vi.fn(async () => "m"),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: (...a: unknown[]) => H.enqueueMock(...a) }));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: vi.fn(() => "k") },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/identity/visitor-repo.js", () => ({
  findById: (...a: unknown[]) => H.visitorFindByIdMock(...a),
  findByHash: (...a: unknown[]) => H.visitorFindByHashMock(...a),
  listByTenant: (...a: unknown[]) => H.visitorListMock(...a),
  insert: (...a: unknown[]) => H.visitorInsertMock(...a),
  touch: (...a: unknown[]) => H.visitorTouchMock(...a),
  markMerged: (...a: unknown[]) => H.visitorMarkMergedMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/profiles/repo.js", () => ({
  findById: (...a: unknown[]) => H.profileFindByIdMock(...a),
  insert: (...a: unknown[]) => H.profileInsertMock(...a),
  markMerged: (...a: unknown[]) => H.profileMarkMergedMock(...a),
  update: vi.fn(async () => true),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  findByIds: vi.fn(async () => []),
  findByIdTx: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/identity/repo.js", () => ({
  insert: (...a: unknown[]) => H.identityInsertMock(...a),
  findByHash: (...a: unknown[]) => H.identityFindByHashMock(...a),
  reassignProfile: (...a: unknown[]) => H.identityReassignMock(...a),
  findByProfileId: vi.fn(async () => []),
  findById: vi.fn(async () => null),
  deleteById: vi.fn(async () => true),
  deleteByProfile: vi.fn(async () => 0),
  findByHashTx: vi.fn(async () => []),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/identity/device-repo.js", () => ({
  reassignProfile: (...a: unknown[]) => H.deviceReassignMock(...a),
  findByToken: vi.fn(async () => null),
  listByProfile: vi.fn(async () => ({ rows: [], total: 0 })),
  countByProfile: vi.fn(async () => 0),
  insert: vi.fn(),
  relink: vi.fn(async () => true),
  deleteByProfile: vi.fn(async () => 0),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/events/repo.js", () => ({
  reassignProfile: (...a: unknown[]) => H.eventsReassignMock(...a),
  insert: vi.fn(),
  insertBatch: vi.fn(),
  listByProfile: vi.fn(async () => ({ rows: [], total: 0 })),
  getTimeline: vi.fn(async () => ({ rows: [], total: 0 })),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/identity/name-key-repo.js", () => ({
  deleteByProfile: (...a: unknown[]) => H.nameKeyDeleteMock(...a),
  findByProfile: vi.fn(async () => null),
  upsert: vi.fn(),
  findCandidates: vi.fn(async () => []),
  toView: (r: Record<string, unknown>) => r,
}));

const { buildApp } = await import("../src/app.js");

const auth = (roles = ["cdp_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function makeVisitor(overrides: Record<string, unknown> = {}) {
  return {
    id: VISITOR_ID,
    tenantId: TENANT,
    visitorKeyHash: hashIdentifier("visitorId", VISITOR_KEY),
    anonymousProfileId: ANON_PROFILE,
    mergedIntoProfileId: null,
    status: "anonymous",
    deviceType: "web",
    firstSeenAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-01-02T00:00:00.000Z"),
    mergedAt: null,
    eventsMerged: 0,
    identifiersMerged: 0,
    devicesMerged: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.visitorFindByHashMock.mockResolvedValue(null);
  H.visitorListMock.mockResolvedValue({ rows: [], total: 0 });
  H.visitorInsertMock.mockResolvedValue(undefined);
  H.visitorTouchMock.mockResolvedValue(undefined);
  H.visitorMarkMergedMock.mockResolvedValue(true);
  H.profileInsertMock.mockResolvedValue(undefined);
  H.profileMarkMergedMock.mockResolvedValue(undefined);
  H.identityInsertMock.mockResolvedValue(undefined);
  H.identityFindByHashMock.mockResolvedValue([]);
  H.eventsReassignMock.mockResolvedValue(7);
  H.identityReassignMock.mockResolvedValue(2);
  H.deviceReassignMock.mockResolvedValue(1);
  H.nameKeyDeleteMock.mockResolvedValue(1);
});

describe("POST /v1/cdp/identity/anonymous-visitors", () => {
  const url = "/v1/cdp/identity/anonymous-visitors";
  const payload = { visitorKey: VISITOR_KEY, deviceType: "web" };

  it("202 — publishes visitor track command", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_user"]), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.created).toBe(true);
    expect(r.json().data.status).toBe("anonymous");
    expect(H.publishMock).toHaveBeenCalled();
    expect(H.profileInsertMock).not.toHaveBeenCalled();
    expect(H.identityInsertMock).not.toHaveBeenCalled();
    expect(H.visitorInsertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — publish payload excludes raw visitor key", async () => {
    const app = await buildApp();
    await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(JSON.stringify(H.publishMock.mock.calls)).not.toContain(VISITOR_KEY);
    await app.close();
  });

  it("202 — publish carries anonymous shell metadata", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST", url, headers: auth(), payload: { ...payload, attributes: { landingPage: "/schemes" } },
    });
    const call = H.publishMock.mock.calls[0]?.[1] as { payload: { attributes: Record<string, unknown> } };
    expect(call.payload.attributes).toEqual({ landingPage: "/schemes", anonymous: true });
    await app.close();
  });

  it("202 — route does not enqueue on track", async () => {
    const app = await buildApp();
    await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(H.enqueueMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — returning visitor publishes touch heartbeat", async () => {
    H.visitorFindByHashMock.mockResolvedValue(makeVisitor());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.created).toBe(false);
    expect(r.json().data.anonymousProfileId).toBe(ANON_PROFILE);
    expect(H.publishMock).toHaveBeenCalledWith(
      "cdp.f3.route_write",
      expect.objectContaining({ payload: expect.objectContaining({ op: "visitor_touch" }) }),
    );
    expect(H.visitorTouchMock).not.toHaveBeenCalled();
    expect(H.profileInsertMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("400 — visitor key shorter than the minimum", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { visitorKey: "short" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — unknown device type", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { ...payload, deviceType: "fridge" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["viewer"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/cdp/identity/anonymous-visitors", () => {
  it("200 — paginated register, token reference truncated", async () => {
    H.visitorListMock.mockResolvedValue({ rows: [makeVisitor()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/cdp/identity/anonymous-visitors?limit=10", headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 10, total: 1 });
    await app.close();
  });

  it("200 — passes the status filter through", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/cdp/identity/anonymous-visitors?limit=50&status=merged", headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(H.visitorListMock).toHaveBeenCalledWith(TENANT, 50, 0, { status: "merged" });
    await app.close();
  });

  it("400 — limit is mandatory", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/identity/anonymous-visitors", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — unknown status filter", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/cdp/identity/anonymous-visitors?limit=10&status=ghost", headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/identity/anonymous-visitors?limit=10" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/cdp/identity/anonymous-visitors?limit=10", headers: auth(["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/cdp/identity/anonymous-visitors/:id/stitch", () => {
  const url = `/v1/cdp/identity/anonymous-visitors/${VISITOR_ID}/stitch`;
  const byId = { knownProfileId: KNOWN_PROFILE, version: 1 };

  function withProfiles(anonRow = anon(), knownRow = known()): void {
    H.profileFindByIdMock.mockImplementation(async (id: string) => {
      if (id === ANON_PROFILE) return anonRow;
      if (id === KNOWN_PROFILE) return knownRow;
      return null;
    });
  }

  it("202 — publishes visitor stitch command", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor());
    withProfiles();
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: byId });
    expect(r.statusCode).toBe(202);
    expect(r.json().data).toMatchObject({
      visitorId: VISITOR_ID,
      anonymousProfileId: ANON_PROFILE,
      knownProfileId: KNOWN_PROFILE,
      status: "accepted",
    });
    expect(H.publishMock).toHaveBeenCalled();
    expect(H.eventsReassignMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — stitch command carries merge plan metadata", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor());
    withProfiles(
      anon({ attributes: { city: "Pune", anonymous: true } }),
      known({ attributes: { name: "Rajesh" } }),
    );
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: byId });
    expect(r.statusCode).toBe(202);
    expect(H.profileMarkMergedMock).not.toHaveBeenCalled();
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();
  });

  it("202 — stitch response includes lineage entry preview", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor());
    withProfiles();
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: byId });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.lineageEntry.source).toBe("anonymous_stitch");
    await app.close();
  });

  it("202 — route does not enqueue stitch events directly", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor());
    withProfiles();
    const app = await buildApp();
    await app.inject({ method: "POST", url, headers: auth(), payload: byId });
    expect(H.enqueueMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — resolves known profile then publishes stitch", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor());
    withProfiles();
    H.identityFindByHashMock.mockResolvedValue([{ profileId: KNOWN_PROFILE }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { identifiers: [{ type: "email", value: "rajesh@example.gov.in" }], version: 1 },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.knownProfileId).toBe(KNOWN_PROFILE);
    expect(H.identityFindByHashMock).toHaveBeenCalledWith(
      hashIdentifier("email", "rajesh@example.gov.in"), TENANT,
    );
    await app.close();
  });

  it("422 — identifiers resolve to nothing", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor());
    withProfiles();
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { identifiers: [{ type: "email", value: "nobody@example.gov.in" }], version: 1 },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("NO_KNOWN_PROFILE");
    await app.close();
  });

  it("422 — identifiers resolve to two different profiles", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor());
    withProfiles();
    H.identityFindByHashMock.mockResolvedValue([{ profileId: KNOWN_PROFILE }, { profileId: "bbbbbbbb-5555-4000-8000-000000000001" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { identifiers: [{ type: "email", value: "shared@example.gov.in" }], version: 1 },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("AMBIGUOUS_IDENTITY");
    expect(H.profileMarkMergedMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("422 — an edge pointing back at the shell does not count as a known profile", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor());
    withProfiles();
    H.identityFindByHashMock.mockResolvedValue([{ profileId: ANON_PROFILE }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { identifiers: [{ type: "visitorId", value: VISITOR_KEY }], version: 1 },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("NO_KNOWN_PROFILE");
    await app.close();
  });

  it("422 — the visitor was already stitched", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor({ status: "merged", mergedIntoProfileId: KNOWN_PROFILE }));
    withProfiles();
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: byId });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("STITCH_INVALID");
    await app.close();
  });

  it("422 — the target is itself an anonymous shell", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor());
    withProfiles(anon(), known({ profileType: ANONYMOUS_PROFILE_TYPE }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: byId });
    expect(r.statusCode).toBe(422);
    expect(H.eventsReassignMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("404 — unknown visitor", async () => {
    H.visitorFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: byId });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — the shell profile has gone", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor());
    H.profileFindByIdMock.mockImplementation(async (id: string) => (id === KNOWN_PROFILE ? known() : null));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: byId });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — unknown known profile", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor());
    H.profileFindByIdMock.mockImplementation(async (id: string) => (id === ANON_PROFILE ? anon() : null));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: byId });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("202 — version conflicts deferred to consumer", async () => {
    H.visitorFindByIdMock.mockResolvedValue(makeVisitor());
    withProfiles();
    H.visitorMarkMergedMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: byId });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();
  });

  it("400 — neither knownProfileId nor identifiers supplied", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — both knownProfileId and identifiers supplied", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { knownProfileId: KNOWN_PROFILE, identifiers: [{ type: "email", value: "a@b.gov.in" }], version: 1 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — version is required", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { knownProfileId: KNOWN_PROFILE } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — visitor id is not a uuid", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/identity/anonymous-visitors/nope/stitch", headers: auth(), payload: byId,
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: byId });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["viewer"]), payload: byId });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
