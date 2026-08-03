/**
 * CR-CDP-02 — phonetic / approximate name matching.
 * Table-driven unit coverage of the pure matcher (identical, transliteration variant,
 * near-miss that must land in review, and outright non-match) plus route coverage for
 * name-key indexing and search (happy path + 400/401/403/404/422).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  normalizeName,
  nameTokens,
  canonicalName,
  phoneticKey,
  levenshtein,
  levenshteinRatio,
  phoneticOverlap,
  scoreNameMatch,
  classifyNameScore,
  rankNameMatches,
  PHONETIC_MATCH_THRESHOLD,
  PHONETIC_REVIEW_THRESHOLD,
  PHONETIC_WEIGHTS,
} from "../src/modules/identity/phonetic-domain.js";
import { soundex } from "../src/modules/identity/resolution-domain.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-2222-4000-8000-000000000001";

// ── PURE: normalisation ───────────────────────────────────────────────────────

describe("normalizeName", () => {
  const cases: Array<[string, string, string]> = [
    ["lowercases and trims", "  Rajesh Kumar  ", "rajesh kumar"],
    ["collapses inner whitespace", "Rajesh    Kumar", "rajesh kumar"],
    ["folds diacritics", "Zoë Müller", "zoe muller"],
    ["folds Devanagari-transliterated vowel marks", "Sītā Rāman", "sita raman"],
    ["drops punctuation and digits", "Rajesh-Kumar (2) 98765", "rajesh kumar"],
    ["drops honorifics", "Shri Rajesh Kumar", "rajesh kumar"],
    ["drops Smt/Kumari", "Smt Kumari Meena", "meena"],
    ["drops Dr and generational suffixes", "Dr. Rajesh Kumar Jr", "rajesh kumar"],
    ["returns empty for an unusable name", "Mr.", ""],
    ["returns empty for digits only", "12345 !!!", ""],
    ["returns empty for an empty string", "", ""],
  ];

  for (const [label, input, expected] of cases) {
    it(label, () => {
      expect(normalizeName(input)).toBe(expected);
    });
  }
});

describe("nameTokens / canonicalName", () => {
  it("tokenises the normalized form", () => {
    expect(nameTokens("Shri Rajesh Kumar")).toEqual(["rajesh", "kumar"]);
  });

  it("returns no tokens for an unusable name", () => {
    expect(nameTokens("!!!")).toEqual([]);
  });

  it("sorts tokens so field order cannot matter", () => {
    expect(canonicalName("Kumar Rajesh")).toBe("kumar rajesh");
    expect(canonicalName("Rajesh Kumar")).toBe("kumar rajesh");
  });
});

describe("phoneticKey", () => {
  it("is the sorted set of token Soundex codes", () => {
    expect(phoneticKey("Rajesh Kumar")).toBe(`${soundex("kumar")} ${soundex("rajesh")}`);
    expect(phoneticKey("Rajesh Kumar")).toBe("K560 R220");
  });

  it("is stable under token reordering", () => {
    expect(phoneticKey("Kumar Rajesh")).toBe(phoneticKey("Rajesh Kumar"));
  });

  it("agrees across a transliteration variant", () => {
    expect(phoneticKey("Rajesh Kumaar")).toBe(phoneticKey("Rajesh Kumar"));
  });

  it("deduplicates a repeated token", () => {
    expect(phoneticKey("Kumar Kumar")).toBe("K560");
  });

  it("is empty for an unusable name", () => {
    expect(phoneticKey("12345")).toBe("");
  });
});

// ── PURE: distance helpers ────────────────────────────────────────────────────

describe("levenshtein", () => {
  const cases: Array<[string, string, number]> = [
    ["", "", 0],
    ["abc", "abc", 0],
    ["", "abc", 3],
    ["abc", "", 3],
    ["kitten", "sitting", 3],
    ["kumar", "kumaar", 1],
    ["flaw", "lawn", 2],
  ];

  for (const [a, b, expected] of cases) {
    it(`"${a}" → "${b}" is ${expected}`, () => {
      expect(levenshtein(a, b)).toBe(expected);
      // Edit distance is symmetric; an asymmetric implementation would score a pair
      // differently depending on which record arrived first.
      expect(levenshtein(b, a)).toBe(expected);
    });
  }
});

describe("levenshteinRatio", () => {
  it("is 1 for identical strings, including two empty ones", () => {
    expect(levenshteinRatio("abc", "abc")).toBe(1);
    expect(levenshteinRatio("", "")).toBe(1);
  });

  it("is 0 when nothing is shared", () => {
    expect(levenshteinRatio("abc", "xyz")).toBe(0);
  });

  it("rounds to 4 decimal places", () => {
    expect(levenshteinRatio("kitten", "sitting")).toBe(0.5714);
  });
});

describe("phoneticOverlap", () => {
  it("is 1 for names whose codes agree", () => {
    expect(phoneticOverlap("Rajesh Kumar", "Rajesh Kumaar")).toBe(1);
  });

  it("is partial when only one token agrees", () => {
    expect(phoneticOverlap("Rajesh Kumar", "Ramesh Kumar")).toBe(0.3333);
  });

  it("is 0 when neither side has usable tokens", () => {
    expect(phoneticOverlap("Rajesh", "123")).toBe(0);
    expect(phoneticOverlap("123", "Rajesh")).toBe(0);
  });
});

// ── PURE: scoreNameMatch (table-driven) ───────────────────────────────────────

describe("scoreNameMatch", () => {
  const table: Array<{
    label: string;
    a: string;
    b: string;
    expect: "match" | "review" | "no_match";
  }> = [
    // Identical / trivially equivalent
    { label: "identical", a: "Rajesh Kumar", b: "Rajesh Kumar", expect: "match" },
    { label: "case and spacing only", a: "RAJESH  KUMAR", b: "rajesh kumar", expect: "match" },
    { label: "honorific only", a: "Shri Rajesh Kumar", b: "Rajesh Kumar", expect: "match" },
    { label: "diacritics only", a: "Zoë Müller", b: "Zoe Muller", expect: "match" },
    { label: "surname/first-name swap", a: "Rajesh Kumar", b: "Kumar Rajesh", expect: "match" },
    // Transliteration and typo variants — the reason this requirement exists
    { label: "doubled vowel", a: "Rajesh Kumar", b: "Rajesh Kumaar", expect: "match" },
    { label: "doubled consonant", a: "Krishnan", b: "Krishnnan", expect: "match" },
    { label: "vowel substitution", a: "Sanjay", b: "Sunjay", expect: "match" },
    { label: "y/i ending", a: "Sanjay Gupta", b: "Sanjai Gupta", expect: "match" },
    { label: "dropped h", a: "Abhishek", b: "Abhisek", expect: "match" },
    { label: "inserted letter", a: "Rajesh Kumar", b: "Rajeshh Kumar", expect: "match" },
    // Near misses that must NOT auto-match
    { label: "different first name, same surname", a: "Rajesh Kumar", b: "Ramesh Kumar", expect: "review" },
    { label: "short phonetic twin", a: "Meena", b: "Mina", expect: "review" },
    { label: "ksh/x transliteration of a short name", a: "Lakshmi", b: "Laxmi", expect: "review" },
    // Non-matches
    { label: "unrelated names", a: "Rajesh Kumar", b: "Priya Sharma", expect: "no_match" },
    { label: "missing surname", a: "Rajesh Kumar", b: "Rajesh", expect: "no_match" },
    { label: "empty right side", a: "Rajesh Kumar", b: "", expect: "no_match" },
    { label: "unusable right side", a: "Rajesh Kumar", b: "12345", expect: "no_match" },
    { label: "unusable left side", a: "Mr.", b: "Rajesh Kumar", expect: "no_match" },
  ];

  for (const row of table) {
    it(`${row.label}: "${row.a}" vs "${row.b}" → ${row.expect}`, () => {
      const s = scoreNameMatch(row.a, row.b);
      expect(s.classification).toBe(row.expect);
      if (row.expect === "match") expect(s.score).toBeGreaterThanOrEqual(PHONETIC_MATCH_THRESHOLD);
      if (row.expect === "review") {
        expect(s.score).toBeGreaterThanOrEqual(PHONETIC_REVIEW_THRESHOLD);
        expect(s.score).toBeLessThan(PHONETIC_MATCH_THRESHOLD);
      }
      if (row.expect === "no_match") expect(s.score).toBeLessThan(PHONETIC_REVIEW_THRESHOLD);
    });
  }

  it("scores an exact normalized match as 1 and flags it exact", () => {
    const s = scoreNameMatch("Shri Rajesh Kumar", "rajesh kumar");
    expect(s.score).toBe(1);
    expect(s.exact).toBe(true);
    expect(s.orderInsensitiveExact).toBe(true);
  });

  it("scores a token swap just below 1 and flags it as order-insensitive only", () => {
    const s = scoreNameMatch("Rajesh Kumar", "Kumar Rajesh");
    expect(s.score).toBe(0.98);
    expect(s.exact).toBe(false);
    expect(s.orderInsensitiveExact).toBe(true);
  });

  it("returns zeroed signals for an unusable name rather than a small non-zero score", () => {
    const s = scoreNameMatch("Rajesh Kumar", "!!!");
    expect(s).toEqual({
      score: 0, classification: "no_match", exact: false, orderInsensitiveExact: false,
      jaroWinkler: 0, phonetic: 0, edit: 0,
    });
  });

  it("is symmetric", () => {
    const ab = scoreNameMatch("Rajesh Kumar", "Rajesh Kumaar");
    const ba = scoreNameMatch("Rajesh Kumaar", "Rajesh Kumar");
    expect(ab.score).toBe(ba.score);
  });

  it("is deterministic across repeated calls", () => {
    const first = scoreNameMatch("Lakshmi", "Laxmi").score;
    for (let i = 0; i < 5; i++) expect(scoreNameMatch("Lakshmi", "Laxmi").score).toBe(first);
  });

  it("composes exactly the three documented weights", () => {
    const s = scoreNameMatch("Rajesh Kumar", "Ramesh Kumar");
    const recomputed = Math.round(
      (PHONETIC_WEIGHTS.jaroWinkler * s.jaroWinkler
        + PHONETIC_WEIGHTS.phonetic * s.phonetic
        + PHONETIC_WEIGHTS.edit * s.edit) * 10000,
    ) / 10000;
    expect(s.score).toBe(recomputed);
    expect(PHONETIC_WEIGHTS.jaroWinkler + PHONETIC_WEIGHTS.phonetic + PHONETIC_WEIGHTS.edit).toBe(1);
  });
});

describe("classifyNameScore", () => {
  it("puts the thresholds themselves in the higher band", () => {
    expect(classifyNameScore(PHONETIC_MATCH_THRESHOLD)).toBe("match");
    expect(classifyNameScore(PHONETIC_REVIEW_THRESHOLD)).toBe("review");
  });

  it("classifies the bands either side", () => {
    expect(classifyNameScore(1)).toBe("match");
    expect(classifyNameScore(PHONETIC_MATCH_THRESHOLD - 0.0001)).toBe("review");
    expect(classifyNameScore(PHONETIC_REVIEW_THRESHOLD - 0.0001)).toBe("no_match");
    expect(classifyNameScore(0)).toBe("no_match");
  });
});

// ── PURE: rankNameMatches ─────────────────────────────────────────────────────

describe("rankNameMatches", () => {
  const candidates = [
    { profileId: "p-unrelated", name: "Priya Sharma" },
    { profileId: "p-variant", name: "Rajesh Kumaar" },
    { profileId: "p-review", name: "Ramesh Kumar" },
    { profileId: "p-exact", name: "Rajesh Kumar" },
  ];

  it("returns matches best-first and drops non-matches", () => {
    const ranked = rankNameMatches("Rajesh Kumar", candidates, 10);
    expect(ranked.map((c) => c.profileId)).toEqual(["p-exact", "p-variant", "p-review"]);
    expect(ranked.map((c) => c.classification)).toEqual(["match", "match", "review"]);
  });

  it("applies the limit after ranking", () => {
    expect(rankNameMatches("Rajesh Kumar", candidates, 2).map((c) => c.profileId))
      .toEqual(["p-exact", "p-variant"]);
  });

  it("returns nothing for a zero or negative limit", () => {
    expect(rankNameMatches("Rajesh Kumar", candidates, 0)).toEqual([]);
    expect(rankNameMatches("Rajesh Kumar", candidates, -5)).toEqual([]);
  });

  it("breaks ties on profileId so ordering is stable across DB read orders", () => {
    const tied = [
      { profileId: "zzz", name: "Rajesh Kumar" },
      { profileId: "aaa", name: "Rajesh Kumar" },
    ];
    expect(rankNameMatches("Rajesh Kumar", tied, 10).map((c) => c.profileId)).toEqual(["aaa", "zzz"]);
    expect(rankNameMatches("Rajesh Kumar", [...tied].reverse(), 10).map((c) => c.profileId))
      .toEqual(["aaa", "zzz"]);
  });

  it("exposes the component signals for a steward to read", () => {
    const ranked = rankNameMatches("Rajesh Kumar", [{ profileId: "p", name: "Ramesh Kumar" }], 1);
    expect(ranked[0]?.signals.phonetic).toBe(0.3333);
    expect(ranked[0]?.signals.jaroWinkler).toBeGreaterThan(0.9);
  });

  it("returns nothing when the query name is unusable", () => {
    expect(rankNameMatches("!!!", candidates, 10)).toEqual([]);
  });

  it("returns nothing for an empty candidate window", () => {
    expect(rankNameMatches("Rajesh Kumar", [], 10)).toEqual([]);
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  findByProfileMock: vi.fn(),
  upsertMock: vi.fn(),
  findCandidatesMock: vi.fn(),
  profileFindByIdMock: vi.fn(),
  enqueueMock: vi.fn(),
  publishMock: vi.fn(),
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

vi.mock("../src/modules/identity/name-key-repo.js", () => ({
  findByProfile: (...a: unknown[]) => H.findByProfileMock(...a),
  upsert: (...a: unknown[]) => H.upsertMock(...a),
  findCandidates: (...a: unknown[]) => H.findCandidatesMock(...a),
  deleteByProfile: vi.fn(async () => 0),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/profiles/repo.js", () => ({
  findById: (...a: unknown[]) => H.profileFindByIdMock(...a),
  update: vi.fn(async () => true),
  insert: vi.fn(),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  markMerged: vi.fn(),
  findByIds: vi.fn(async () => []),
  findByIdTx: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

const { buildApp } = await import("../src/app.js");

const auth = (roles = ["cdp_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    tenantId: TENANT,
    profileType: "individual",
    attributes: {},
    sourceLineage: [],
    mergedFromIds: [],
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
  H.publishMock.mockResolvedValue("m");
  H.upsertMock.mockResolvedValue(undefined);
  H.findByProfileMock.mockResolvedValue(null);
  H.findCandidatesMock.mockResolvedValue([]);
  H.profileFindByIdMock.mockResolvedValue(makeProfile());
});

describe("POST /v1/cdp/identity/name-keys", () => {
  const url = "/v1/cdp/identity/name-keys";
  const payload = { profileId: PROFILE_ID, name: "Shri Rajesh Kumar" };

  it("202 — publishes name-key index command", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.phoneticKey).toBe("K560 R220");
    expect(r.json().data.reindexed).toBe(false);
    expect(H.publishMock).toHaveBeenCalledWith(
      "cdp.f3.route_write",
      expect.objectContaining({
        payload: expect.objectContaining({
          op: "name_key_index",
          profileId: PROFILE_ID,
          nameNormalized: "rajesh kumar",
          phoneticKey: "K560 R220",
        }),
      }),
    );
    expect(H.upsertMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — command carries normalized name; response omits raw name", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    const published = JSON.stringify(H.publishMock.mock.calls[0]?.[1]);
    expect(published).toContain("rajesh kumar");
    expect(published).not.toContain("Shri Rajesh Kumar");
    expect(JSON.stringify(r.json().data)).not.toContain("rajesh kumar");
    await app.close();
  });

  it("202 — reindexes an existing key in place", async () => {
    H.findByProfileMock.mockResolvedValue({ id: "dddddddd-1111-4000-8000-000000000001", version: 3 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.reindexed).toBe(true);
    expect(r.json().data.id).toBe("dddddddd-1111-4000-8000-000000000001");
    expect(H.publishMock).toHaveBeenCalledWith(
      "cdp.f3.route_write",
      expect.objectContaining({ payload: expect.objectContaining({ op: "name_key_index", reindexed: true }) }),
    );
    await app.close();
  });

  it("400 — profileId must be a uuid", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { ...payload, profileId: "x" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — name is required", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { profileId: PROFILE_ID } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — a merged profile cannot be indexed", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile({ profileType: "merged" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — the name has nothing matchable in it", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { profileId: PROFILE_ID, name: "12345" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("UNINDEXABLE_NAME");
    expect(H.upsertMock).not.toHaveBeenCalled();
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

describe("POST /v1/cdp/identity/match-name", () => {
  const url = "/v1/cdp/identity/match-name";

  it("200 — ranks the candidate window and reports the thresholds", async () => {
    H.findCandidatesMock.mockResolvedValue([
      { profileId: "p-exact", name: "rajesh kumar" },
      { profileId: "p-variant", name: "rajesh kumaar" },
      { profileId: "p-no", name: "priya sharma" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(["cdp_user"]), payload: { name: "Rajesh Kumar", limit: 10 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.candidates.map((c: { profileId: string }) => c.profileId))
      .toEqual(["p-exact", "p-variant"]);
    expect(r.json().data.thresholds).toEqual({
      match: PHONETIC_MATCH_THRESHOLD, review: PHONETIC_REVIEW_THRESHOLD,
    });
    await app.close();
  });

  it("200 — probes on both the phonetic key and the normalized name", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { name: "Shri Rajesh Kumar" } });
    expect(r.statusCode).toBe(200);
    expect(H.findCandidatesMock).toHaveBeenCalledWith(TENANT, "K560 R220", "rajesh kumar", 200);
    await app.close();
  });

  it("200 — empty window yields no candidates", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { name: "Rajesh Kumar" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.candidates).toEqual([]);
    await app.close();
  });

  it("400 — name is required", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — limit above the 200 cap", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { name: "Rajesh", limit: 201 } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("422 — the search term has nothing matchable in it", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { name: "..." } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("UNMATCHABLE_NAME");
    expect(H.findCandidatesMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: { name: "Rajesh Kumar" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["viewer"]), payload: { name: "Rajesh Kumar" } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
