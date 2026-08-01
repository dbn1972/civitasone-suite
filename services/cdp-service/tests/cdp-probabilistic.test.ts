/**
 * CDP-002 — probabilistic identity resolution.
 * Unit coverage of every pure function (including edge cases) + route coverage.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  scoreCandidate,
  classify,
  nameTokenOverlap,
  rankCandidates,
  toCandidateAttributes,
  FEATURE_WEIGHTS,
  MATCH_THRESHOLD,
  REVIEW_THRESHOLD,
} from "../src/modules/identity/probabilistic-domain.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const P1 = "bbbbbbbb-1111-4000-8000-000000000001";
const P2 = "bbbbbbbb-2222-4000-8000-000000000002";
const P3 = "bbbbbbbb-3333-4000-8000-000000000003";

// ── PURE: nameTokenOverlap ────────────────────────────────────────────────────

describe("nameTokenOverlap", () => {
  it("is 1 for identical names regardless of case and padding", () => {
    expect(nameTokenOverlap("Rajesh Kumar", "  rajesh   kumar ")).toBe(1);
  });

  it("is order-insensitive", () => {
    expect(nameTokenOverlap("Kumar Rajesh", "Rajesh Kumar")).toBe(1);
  });

  it("gives partial credit for a shared surname", () => {
    // {rajesh, kumar} vs {suresh, kumar} → 1 shared of 3 distinct.
    expect(nameTokenOverlap("Rajesh Kumar", "Suresh Kumar")).toBeCloseTo(1 / 3, 10);
  });

  it("is 0 for disjoint names", () => {
    expect(nameTokenOverlap("Asha", "Bimal")).toBe(0);
  });

  it("is 0 when either side has no tokens", () => {
    expect(nameTokenOverlap("", "Asha")).toBe(0);
    expect(nameTokenOverlap("Asha", "   ")).toBe(0);
    expect(nameTokenOverlap(".,", "Asha")).toBe(0);
  });

  it("splits on punctuation used by initials", () => {
    expect(nameTokenOverlap("R.K. Nair", "Nair R K")).toBe(1);
  });
});

// ── PURE: scoreCandidate ──────────────────────────────────────────────────────

describe("scoreCandidate", () => {
  it("scores a full agreement as 1", () => {
    const a = { email: "a@x.test", phone: "+91 99999 00001", name: "Asha Rao", city: "Pune" };
    expect(scoreCandidate(a, { ...a })).toBe(1);
  });

  it("scores total disagreement as 0", () => {
    expect(scoreCandidate(
      { email: "a@x.test", phone: "9999900001", name: "Asha", city: "Pune" },
      { email: "b@x.test", phone: "8888800002", name: "Bimal", city: "Kochi" },
    )).toBe(0);
  });

  it("returns 0 when no feature is comparable", () => {
    expect(scoreCandidate({}, {})).toBe(0);
    expect(scoreCandidate({ email: "a@x.test" }, { phone: "9999900001" })).toBe(0);
  });

  it("ignores blank strings rather than treating them as agreement", () => {
    expect(scoreCandidate({ email: "   " }, { email: "   " })).toBe(0);
  });

  it("normalises email case and surrounding whitespace", () => {
    expect(scoreCandidate({ email: " A@X.TEST " }, { email: "a@x.test" })).toBe(1);
  });

  it("compares phones on their last ten digits", () => {
    expect(scoreCandidate({ phone: "+91-99999-00001" }, { phone: "09999900001" })).toBe(1);
    expect(scoreCandidate({ phone: "99999 00001" }, { phone: "9999900002" })).toBe(0);
  });

  it("divides by the compared weight, so absence is not disagreement", () => {
    // Email agrees; the other side simply has no phone/name/city to compare.
    expect(scoreCandidate(
      { email: "a@x.test", phone: "9999900001" },
      { email: "a@x.test" },
    )).toBe(1);
  });

  it("weights email above phone above name above city", () => {
    const emailOnly = scoreCandidate(
      { email: "a@x.test", city: "Pune" },
      { email: "a@x.test", city: "Kochi" },
    );
    const cityOnly = scoreCandidate(
      { email: "a@x.test", city: "Pune" },
      { email: "b@x.test", city: "Pune" },
    );
    const compared = FEATURE_WEIGHTS.email + FEATURE_WEIGHTS.city;
    expect(emailOnly).toBeCloseTo(FEATURE_WEIGHTS.email / compared, 4);
    expect(cityOnly).toBeCloseTo(FEATURE_WEIGHTS.city / compared, 4);
    expect(emailOnly).toBeGreaterThan(cityOnly);
  });

  it("gives names partial credit from token overlap", () => {
    const score = scoreCandidate({ name: "Rajesh Kumar" }, { name: "Suresh Kumar" });
    expect(score).toBeCloseTo(1 / 3, 4);
  });

  it("stays within [0, 1] and rounds to 4dp", () => {
    const score = scoreCandidate(
      { email: "a@x.test", phone: "9999900001", name: "Rajesh Kumar", city: "Pune" },
      { email: "a@x.test", phone: "9999900002", name: "Suresh Kumar", city: "Pune" },
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBe(Math.round(score * 10000) / 10000);
  });

  it("is symmetric", () => {
    const a = { email: "a@x.test", name: "Rajesh Kumar" };
    const b = { email: "a@x.test", name: "Kumar" };
    expect(scoreCandidate(a, b)).toBe(scoreCandidate(b, a));
  });
});

// ── PURE: classify ────────────────────────────────────────────────────────────

describe("classify", () => {
  it("classifies at and above 0.85 as match", () => {
    expect(classify(MATCH_THRESHOLD)).toBe("match");
    expect(classify(1)).toBe("match");
  });

  it("classifies the review band inclusively at 0.60", () => {
    expect(classify(REVIEW_THRESHOLD)).toBe("review");
    expect(classify(0.8499)).toBe("review");
  });

  it("classifies below 0.60 as no_match", () => {
    expect(classify(0.5999)).toBe("no_match");
    expect(classify(0)).toBe("no_match");
  });
});

// ── PURE: toCandidateAttributes ───────────────────────────────────────────────

describe("toCandidateAttributes", () => {
  it("projects the four scored features and their aliases", () => {
    expect(toCandidateAttributes({
      emailAddress: "a@x.test", mobile: "9999900001", fullName: "Asha Rao", town: "Pune", extra: "ignored",
    })).toEqual({ email: "a@x.test", phone: "9999900001", name: "Asha Rao", city: "Pune" });
  });

  it("prefers the canonical key over the alias", () => {
    expect(toCandidateAttributes({ email: "primary@x.test", emailAddress: "alias@x.test" }).email)
      .toBe("primary@x.test");
  });

  it("drops non-string and blank values instead of coercing them", () => {
    expect(toCandidateAttributes({ email: { a: 1 }, phone: 999, name: "  ", city: null })).toEqual({});
  });
});

// ── PURE: rankCandidates ──────────────────────────────────────────────────────

describe("rankCandidates", () => {
  const attributes = { email: "a@x.test", phone: "9999900001", name: "Asha Rao", city: "Pune" };

  it("orders best-first and drops no_match candidates", () => {
    const ranked = rankCandidates(attributes, [
      // Nothing agrees → no_match, must be dropped.
      { profileId: P3, attributes: { email: "b@x.test", phone: "8888800002", name: "Bimal", city: "Kochi" } },
      // Exact agreement → match.
      { profileId: P1, attributes: { email: "a@x.test", phone: "9999900001", name: "Asha Rao", city: "Pune" } },
      // email + city agree, phone differs, surname shared → lands in the review band.
      { profileId: P2, attributes: { email: "a@x.test", phone: "1111100000", name: "Suresh Rao", city: "Pune" } },
    ], 10);

    expect(ranked.map((c) => c.profileId)).toEqual([P1, P2]);
    expect(ranked[0]?.classification).toBe("match");
    expect(ranked[0]?.score).toBe(1);
    expect(ranked[1]?.classification).toBe("review");
    expect(ranked[1]?.score).toBeCloseTo(0.6, 4);
  });

  it("respects the limit", () => {
    const ranked = rankCandidates(attributes, [
      { profileId: P1, attributes },
      { profileId: P2, attributes },
    ], 1);
    expect(ranked).toHaveLength(1);
  });

  it("breaks score ties deterministically by profile id", () => {
    const ranked = rankCandidates(attributes, [
      { profileId: P3, attributes },
      { profileId: P1, attributes },
      { profileId: P2, attributes },
    ], 10);
    expect(ranked.map((c) => c.profileId)).toEqual([P1, P2, P3]);
  });

  it("returns an empty list when nothing clears the review threshold", () => {
    expect(rankCandidates(attributes, [{ profileId: P1, attributes: { email: "z@x.test" } }], 10)).toEqual([]);
  });

  it("returns an empty list for no candidates", () => {
    expect(rankCandidates(attributes, [], 10)).toEqual([]);
  });
});

// ── ROUTE ─────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  profileListMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn() }));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: vi.fn(() => "k") },
  queue: { publish: vi.fn() },
}));

vi.mock("../src/modules/profiles/repo.js", () => ({
  findById: vi.fn(async () => null),
  listByTenant: (...a: unknown[]) => H.profileListMock(...a),
  insert: vi.fn(),
  update: vi.fn(),
  markMerged: vi.fn(),
  findByIds: vi.fn(async () => []),
  toView: (r: Record<string, unknown>) => r,
}));

const { buildApp } = await import("../src/app.js");

const auth = (roles = ["cdp_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function profileRow(id: string, attributes: Record<string, unknown>) {
  return {
    id, tenantId: TENANT, profileType: "individual", attributes,
    sourceLineage: [], mergedFromIds: [], version: 1,
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.profileListMock.mockResolvedValue({ rows: [], total: 0 });
});

describe("POST /v1/cdp/identity/resolve-probabilistic", () => {
  const url = "/v1/cdp/identity/resolve-probabilistic";

  it("200 — returns ranked candidates with score and classification", async () => {
    H.profileListMock.mockResolvedValue({
      rows: [
        profileRow(P1, { email: "asha@x.test", phone: "9999900001", name: "Asha Rao", city: "Pune" }),
        profileRow(P2, { email: "asha@x.test", phone: "1111100000", name: "Suresh Rao", city: "Pune" }),
        profileRow(P3, { email: "z@x.test", phone: "1111100000", name: "Zed", city: "Kochi" }),
      ],
      total: 3,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { attributes: { email: "asha@x.test", phone: "9999900001", name: "Asha Rao", city: "Pune" } },
    });
    expect(r.statusCode).toBe(200);
    const candidates = r.json().data.candidates as Array<{ profileId: string; score: number; classification: string }>;
    expect(candidates[0]).toEqual({ profileId: P1, score: 1, classification: "match" });
    expect(candidates.map((c) => c.profileId)).not.toContain(P3);
    expect(r.json().data.thresholds).toEqual({ match: MATCH_THRESHOLD, review: REVIEW_THRESHOLD });
    await app.close();
  });

  it("200 — empty candidate list when the tenant has no profiles", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { attributes: { email: "asha@x.test" } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.candidates).toEqual([]);
    await app.close();
  });

  it("200 — honours an explicit limit", async () => {
    H.profileListMock.mockResolvedValue({
      rows: [
        profileRow(P1, { email: "asha@x.test" }),
        profileRow(P2, { email: "asha@x.test" }),
      ],
      total: 2,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { attributes: { email: "asha@x.test" }, limit: 1 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.candidates).toHaveLength(1);
    await app.close();
  });

  it("400 — no scoreable attribute supplied", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { attributes: {} } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — limit above the 200 cap", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { attributes: { email: "a@x.test" }, limit: 500 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: { attributes: { email: "a@x.test" } } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(["viewer"]), payload: { attributes: { email: "a@x.test" } },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
