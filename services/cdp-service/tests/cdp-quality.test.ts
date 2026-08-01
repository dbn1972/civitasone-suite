/**
 * CDP-010 — data-quality scoring and stewardship, plus CDP-008 profile summary.
 * Unit coverage of every pure quality function, then route coverage for
 * /quality, /steward/quality-summary and /summary.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  computeProfileQuality,
  bucketOf,
  summarizeQuality,
  isStale,
  REQUIRED_ATTRIBUTES,
  STALE_AFTER_DAYS,
} from "../src/modules/steward/quality-domain.js";
import { projectSummary } from "../src/modules/profiles/summary-routes.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const FRESH = "2025-12-01T00:00:00.000Z";
const STALE = "2024-01-01T00:00:00.000Z";

const COMPLETE = {
  name: "Asha Rao",
  phone: "9999900001",
  email: "asha@x.test",
  city: "Pune",
  language: "hi",
  preferredChannel: "whatsapp",
};

// ── PURE: computeProfileQuality ───────────────────────────────────────────────

describe("computeProfileQuality", () => {
  it("scores a complete profile 100 with nothing outstanding", () => {
    expect(computeProfileQuality(COMPLETE, NOW)).toEqual({ score: 100, missingFields: [], staleFields: [] });
  });

  it("scores an empty profile 0 and names every required attribute", () => {
    const q = computeProfileQuality({}, NOW);
    expect(q.score).toBe(0);
    expect(q.missingFields).toEqual(REQUIRED_ATTRIBUTES.map((w) => w.field));
    expect(q.staleFields).toEqual([]);
  });

  it("weights the score by attribute importance, not by field count", () => {
    // name (25) + phone (25) present, everything else absent.
    expect(computeProfileQuality({ name: "Asha Rao", phone: "9999900001" }, NOW).score).toBe(50);
    // language (10) + preferredChannel (5) present — the same field count, far less value.
    expect(computeProfileQuality({ language: "hi", preferredChannel: "sms" }, NOW).score).toBe(15);
  });

  it("treats blank and whitespace-only strings as missing", () => {
    const q = computeProfileQuality({ ...COMPLETE, email: "", city: "   " }, NOW);
    expect(q.missingFields).toEqual(["email", "city"]);
    expect(q.score).toBe(100 - 20 - 15);
  });

  it("treats an empty array as missing but a non-empty one as present", () => {
    expect(computeProfileQuality({ name: [] }, NOW).missingFields).toContain("name");
    expect(computeProfileQuality({ name: ["Asha"] }, NOW).missingFields).not.toContain("name");
  });

  it("treats null and undefined as missing", () => {
    const q = computeProfileQuality({ ...COMPLETE, name: null, phone: undefined }, NOW);
    expect(q.missingFields).toEqual(["name", "phone"]);
  });

  it("gives a stale attribute half credit and reports it", () => {
    const q = computeProfileQuality({ ...COMPLETE, emailVerifiedAt: STALE }, NOW);
    expect(q.staleFields).toEqual(["email"]);
    // email is worth 20; stale earns 10.
    expect(q.score).toBe(90);
    expect(q.missingFields).toEqual([]);
  });

  it("accepts a per-field stamp over the profile-wide one", () => {
    const q = computeProfileQuality({ ...COMPLETE, verifiedAt: STALE, emailVerifiedAt: FRESH }, NOW);
    expect(q.staleFields).not.toContain("email");
    // Every other attribute falls back to the stale profile-wide stamp.
    expect(q.staleFields.sort()).toEqual(["city", "language", "name", "phone", "preferredChannel"]);
  });

  it("does not penalise a profile that has no verification stamp at all", () => {
    expect(computeProfileQuality(COMPLETE, NOW).staleFields).toEqual([]);
  });

  it("ignores an unparseable verification stamp rather than calling it stale", () => {
    const q = computeProfileQuality({ ...COMPLETE, emailVerifiedAt: "yesterday" }, NOW);
    expect(q.staleFields).toEqual([]);
    expect(q.score).toBe(100);
  });

  it("ignores a non-string verification stamp", () => {
    const q = computeProfileQuality({ ...COMPLETE, emailVerifiedAt: 1735689600000 }, NOW);
    expect(q.staleFields).toEqual([]);
  });

  it("never reports a missing attribute as stale", () => {
    const q = computeProfileQuality({ emailVerifiedAt: STALE }, NOW);
    expect(q.missingFields).toContain("email");
    expect(q.staleFields).toEqual([]);
  });

  it("returns an integer score", () => {
    // preferredChannel is worth 5, so a stale one earns 2.5 → rounds to 3.
    const q = computeProfileQuality({ preferredChannel: "sms", preferredChannelVerifiedAt: STALE }, NOW);
    expect(q.score).toBe(3);
    expect(Number.isInteger(q.score)).toBe(true);
  });

  it("defaults `now` to the current time", () => {
    expect(computeProfileQuality(COMPLETE).score).toBe(100);
  });
});

// ── PURE: isStale ─────────────────────────────────────────────────────────────

describe("isStale", () => {
  const ms = STALE_AFTER_DAYS * 86_400_000;

  it("is false exactly on the boundary", () => {
    expect(isStale(new Date(NOW.getTime() - ms), NOW)).toBe(false);
  });

  it("is true one millisecond past the boundary", () => {
    expect(isStale(new Date(NOW.getTime() - ms - 1), NOW)).toBe(true);
  });

  it("is false for a future stamp", () => {
    expect(isStale(new Date(NOW.getTime() + 1000), NOW)).toBe(false);
  });
});

// ── PURE: bucketOf ────────────────────────────────────────────────────────────

describe("bucketOf", () => {
  it("maps the band edges", () => {
    expect(bucketOf(0)).toBe("0-25");
    expect(bucketOf(25)).toBe("0-25");
    expect(bucketOf(26)).toBe("26-50");
    expect(bucketOf(50)).toBe("26-50");
    expect(bucketOf(51)).toBe("51-75");
    expect(bucketOf(75)).toBe("51-75");
    expect(bucketOf(76)).toBe("76-100");
    expect(bucketOf(100)).toBe("76-100");
  });

  it("clamps out-of-range input", () => {
    expect(bucketOf(-10)).toBe("0-25");
    expect(bucketOf(1000)).toBe("76-100");
  });
});

// ── PURE: summarizeQuality ────────────────────────────────────────────────────

describe("summarizeQuality", () => {
  it("returns zeroed buckets for an empty tenant", () => {
    expect(summarizeQuality([], NOW)).toEqual({
      total: 0,
      buckets: { "0-25": 0, "26-50": 0, "51-75": 0, "76-100": 0 },
      averageScore: 0,
      topMissingFields: [],
    });
  });

  it("counts each profile into its band and averages the score", () => {
    const summary = summarizeQuality([
      COMPLETE,                                        // 100 → 76-100
      { name: "A", phone: "9" },                       // 50  → 26-50
      {},                                              // 0   → 0-25
      { name: "B", phone: "9", email: "b@x.test" },     // 70  → 51-75
    ], NOW);
    expect(summary.total).toBe(4);
    expect(summary.buckets).toEqual({ "0-25": 1, "26-50": 1, "51-75": 1, "76-100": 1 });
    expect(summary.averageScore).toBe(Math.round((100 + 50 + 0 + 70) / 4));
  });

  it("ranks the most frequently missing attributes first", () => {
    const summary = summarizeQuality([
      { name: "A", phone: "9", email: "a@x.test", city: "Pune", language: "hi" },
      { name: "B", phone: "9", email: "b@x.test", city: "Pune" },
      { name: "C", phone: "9", email: "c@x.test" },
    ], NOW);
    expect(summary.topMissingFields[0]).toEqual({ field: "preferredChannel", count: 3 });
    expect(summary.topMissingFields[1]).toEqual({ field: "language", count: 2 });
    expect(summary.topMissingFields[2]).toEqual({ field: "city", count: 1 });
  });

  it("breaks equal counts alphabetically so the report is stable", () => {
    const summary = summarizeQuality([{ name: "A", phone: "9", email: "a@x.test", city: "Pune" }], NOW);
    expect(summary.topMissingFields.map((f) => f.field)).toEqual(["language", "preferredChannel"]);
  });
});

// ── PURE: projectSummary (CDP-008) ────────────────────────────────────────────

describe("projectSummary", () => {
  it("keeps only the key attributes and the counts", () => {
    const summary = projectSummary(
      {
        id: PROFILE_ID,
        profileType: "individual",
        attributes: { ...COMPLETE, aadhaarLastFour: "1234", internalNotes: "do not surface" },
        updatedAt: NOW,
      },
      { segmentCount: 3, deviceCount: 2, scoreCount: 1 },
    );
    expect(Object.keys(summary.attributes).sort()).toEqual(
      ["city", "email", "language", "name", "phone", "preferredChannel"],
    );
    expect(summary.attributes.internalNotes).toBeUndefined();
    expect(summary).toMatchObject({ segmentCount: 3, deviceCount: 2, scoreCount: 1, updatedAt: NOW.toISOString() });
  });

  it("omits null and undefined attributes", () => {
    const summary = projectSummary(
      { id: PROFILE_ID, profileType: "individual", attributes: { name: "Asha", email: null }, updatedAt: NOW },
      { segmentCount: 0, deviceCount: 0, scoreCount: 0 },
    );
    expect(summary.attributes).toEqual({ name: "Asha" });
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  profileFindByIdMock: vi.fn(),
  profileListMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  segmentCountMock: vi.fn(),
  deviceCountMock: vi.fn(),
  scoreCountMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn() }));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: vi.fn(),
    makeKey: (t: string, r: string, i: string) => `cdp:${t}:${r}:${i}`,
  },
  queue: { publish: vi.fn(async () => "m") },
}));

vi.mock("../src/modules/profiles/repo.js", () => ({
  findById: (...a: unknown[]) => H.profileFindByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.profileListMock(...a),
  insert: vi.fn(),
  update: vi.fn(),
  markMerged: vi.fn(),
  findByIds: vi.fn(async () => []),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/segments/membership-repo.js", () => ({
  listMembers: vi.fn(async () => ({ rows: [], total: 0 })),
  countMembers: vi.fn(async () => 0),
  countSegmentsForProfile: (...a: unknown[]) => H.segmentCountMock(...a),
  recompute: vi.fn(async () => 0),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/identity/device-repo.js", async (orig) => {
  const actual = await orig<typeof import("../src/modules/identity/device-repo.js")>();
  return { ...actual, countByProfile: (...a: unknown[]) => H.deviceCountMock(...a) };
});

vi.mock("../src/modules/profiles/scores-repo.js", async (orig) => {
  const actual = await orig<typeof import("../src/modules/profiles/scores-repo.js")>();
  return { ...actual, countByProfile: (...a: unknown[]) => H.scoreCountMock(...a) };
});

const { buildApp } = await import("../src/app.js");

const auth = (roles = ["cdp_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function makeProfile(attributes: Record<string, unknown> = COMPLETE, overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID, tenantId: TENANT, profileType: "individual", attributes,
    sourceLineage: [], mergedFromIds: [], version: 1,
    createdAt: NOW, updatedAt: NOW, createdBy: USER, updatedBy: USER,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.profileFindByIdMock.mockResolvedValue(makeProfile());
  H.profileListMock.mockResolvedValue({ rows: [], total: 0 });
  H.segmentCountMock.mockResolvedValue(0);
  H.deviceCountMock.mockResolvedValue(0);
  H.scoreCountMock.mockResolvedValue(0);
  // Default: cold cache — run the loader.
  H.cacheGetOrLoadMock.mockImplementation(async (_k: string, loader: () => Promise<unknown>) => loader());
});

describe("GET /v1/cdp/profiles/:id/quality", () => {
  const url = `/v1/cdp/profiles/${PROFILE_ID}/quality`;

  it("200 — returns the score with the weights that produced it", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.score).toBe(100);
    expect(r.json().data.missingFields).toEqual([]);
    expect(r.json().data.staleAfterDays).toBe(STALE_AFTER_DAYS);
    expect(r.json().data.weights).toHaveLength(REQUIRED_ATTRIBUTES.length);
    await app.close();
  });

  it("200 — names the missing attributes on a sparse profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile({ name: "Asha Rao" }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.score).toBe(25);
    expect(r.json().data.missingFields).toEqual(["phone", "email", "city", "language", "preferredChannel"]);
    await app.close();
  });

  it("400 — non-uuid profile id", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/profiles/nope/quality", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — merged profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile(COMPLETE, { profileType: "merged" }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth(["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/cdp/steward/quality-summary", () => {
  const url = "/v1/cdp/steward/quality-summary";

  it("200 — aggregates the sample into buckets", async () => {
    H.profileListMock.mockResolvedValue({
      rows: [makeProfile(COMPLETE), makeProfile({}), makeProfile({ name: "A", phone: "9" })],
      total: 3,
    });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth(["cdp_steward"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.buckets).toEqual({ "0-25": 1, "26-50": 1, "51-75": 0, "76-100": 1 });
    expect(r.json().data.sampled).toBe(3);
    expect(r.json().data.tenantProfileTotal).toBe(3);
    expect(r.json().data.topMissingFields[0].field).toBeDefined();
    await app.close();
  });

  it("200 — zeroed buckets when the tenant has no profiles", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.buckets).toEqual({ "0-25": 0, "26-50": 0, "51-75": 0, "76-100": 0 });
    expect(r.json().data.averageScore).toBe(0);
    await app.close();
  });

  it("200 — honours an explicit sample size", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: `${url}?sampleSize=25`, headers: auth() });
    expect(H.profileListMock).toHaveBeenCalledWith(TENANT, 25, 0, { profileType: "individual" });
    await app.close();
  });

  it("400 — sample size above the 200 cap", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?sampleSize=1000`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a plain cdp user cannot read the stewardship summary", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth(["cdp_user"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/cdp/profiles/:id/summary (CDP-008)", () => {
  const url = `/v1/cdp/profiles/${PROFILE_ID}/summary`;

  it("200 — compact projection with segment, device and score counts", async () => {
    H.segmentCountMock.mockResolvedValue(4);
    H.deviceCountMock.mockResolvedValue(2);
    H.scoreCountMock.mockResolvedValue(1);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({
      id: PROFILE_ID, profileType: "individual", segmentCount: 4, deviceCount: 2, scoreCount: 1,
    });
    expect(r.json().data.attributes.name).toBe("Asha Rao");
    await app.close();
  });

  it("200 — served from cache without touching the database", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue({
      id: PROFILE_ID, profileType: "individual", attributes: {},
      segmentCount: 9, deviceCount: 9, scoreCount: 9, updatedAt: NOW.toISOString(),
    });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.segmentCount).toBe(9);
    // Cache hit: no profile read, no count queries.
    expect(H.profileFindByIdMock).not.toHaveBeenCalled();
    expect(H.segmentCountMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("200 — keys the cache per tenant and profile", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url, headers: auth() });
    expect(H.cacheGetOrLoadMock.mock.calls[0]?.[0]).toBe(`cdp:${TENANT}:profile_summary:${PROFILE_ID}`);
    await app.close();
  });

  it("404 — unknown profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — merged profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile(COMPLETE, { profileType: "merged" }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — non-uuid profile id", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/profiles/nope/summary", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth(["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
