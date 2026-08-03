/**
 * CR-AI-02 — recommendation → collateral linkage: domain + routes + consumer.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  COLLATERAL_TYPES,
  MAX_REF_LENGTH,
  MAX_TITLE_LENGTH,
  isCollateralType,
  nextOrdinal,
  sortByOrdinal,
  validateCollateral,
} from "../src/modules/collateral/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const REC_ID = "cccccccc-1111-4000-8000-000000000001";
const LINK_ID = "dddddddd-3333-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  markProcessedMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  queuePublishMock: vi.fn(),
  listByRecommendationMock: vi.fn(),
  listAllForRecommendationMock: vi.fn(),
  findByIdMock: vi.fn(),
  insertMock: vi.fn(),
  deleteByIdMock: vi.fn(),
  nbaFindByIdMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
  markProcessed: (...a: unknown[]) => H.markProcessedMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKeyMock(...a),
  },
  queue: { publish: (...a: unknown[]) => H.queuePublishMock(...a) },
}));

vi.mock("../src/modules/collateral/repo.js", async () => {
  const actual = await import("../src/modules/collateral/repo.js");
  return {
    toView: actual.toView,
    listByRecommendation: (...a: unknown[]) => H.listByRecommendationMock(...a),
    listAllForRecommendation: (...a: unknown[]) => H.listAllForRecommendationMock(...a),
    findById: (...a: unknown[]) => H.findByIdMock(...a),
    insert: (...a: unknown[]) => H.insertMock(...a),
    deleteById: (...a: unknown[]) => H.deleteByIdMock(...a),
    update: vi.fn(),
  };
});

vi.mock("../src/modules/nba/repo.js", async () => {
  const actual = await import("../src/modules/nba/repo.js");
  return {
    toView: actual.toView,
    findById: (...a: unknown[]) => H.nbaFindByIdMock(...a),
    listForProfile: vi.fn(async () => ({ rows: [], total: 0 })),
    insert: vi.fn(),
    updateStatus: vi.fn(async () => true),
  };
});

import { buildApp } from "../src/app.js";
import { handleAttachCollateral } from "../src/modules/collateral/consumer.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["recommendation_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const readerAuth = () => auth(["crm_user"]);
const strangerAuth = () => auth(["viewer"]);

function makeLink(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK_ID,
    tenantId: TENANT,
    recommendationId: REC_ID,
    collateralType: "document",
    collateralRef: "doc-123",
    title: "Onboarding pack",
    ordinal: 0,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...overrides,
  };
}

function makeRecommendation() {
  return {
    id: REC_ID,
    tenantId: TENANT,
    profileId: "bbbbbbbb-1111-4000-8000-000000000001",
    recommendationType: "cross_sell",
    productId: null,
    channel: null,
    score: "0.8200",
    status: "served",
    servedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
  };
}

const validPayload = {
  collateralType: "brochure",
  collateralRef: "s3://brochures/2026/spring.pdf",
  title: "Spring 2026 brochure",
};

beforeEach(() => {
  H.queuePublishMock.mockReset();
  H.queuePublishMock.mockResolvedValue(undefined);
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.cacheMakeKeyMock.mockReturnValue("cache-key");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.markProcessedMock.mockResolvedValue(true);
  H.queuePublishMock.mockResolvedValue("msg-1");
  H.listByRecommendationMock.mockResolvedValue({ rows: [], total: 0 });
  H.listAllForRecommendationMock.mockResolvedValue([]);
  H.insertMock.mockResolvedValue(undefined);
  H.deleteByIdMock.mockResolvedValue(true);
  H.findByIdMock.mockResolvedValue(null);
  H.nbaFindByIdMock.mockResolvedValue(makeRecommendation());
});

// ── domain ────────────────────────────────────────────────────────────────────

describe("isCollateralType", () => {
  it("accepts every declared type", () => {
    for (const t of COLLATERAL_TYPES) expect(isCollateralType(t)).toBe(true);
  });

  it("rejects an unknown type", () => {
    expect(isCollateralType("webinar")).toBe(false);
  });

  it("rejects an empty type", () => {
    expect(isCollateralType("")).toBe(false);
  });
});

describe("validateCollateral", () => {
  const base = { collateralType: "document", collateralRef: "doc-1", title: "Doc" };

  it("accepts a minimal valid input", () => {
    expect(validateCollateral(base)).toBeNull();
  });

  it("accepts ordinal 0", () => {
    expect(validateCollateral({ ...base, ordinal: 0 })).toBeNull();
  });

  it("rejects an unknown collateralType", () => {
    expect(validateCollateral({ ...base, collateralType: "webinar" })).toContain("collateralType");
  });

  it("rejects a blank collateralRef", () => {
    expect(validateCollateral({ ...base, collateralRef: "   " })).toBe("collateralRef is required");
  });

  it("rejects a non-string collateralRef", () => {
    const input = { ...base, collateralRef: 7 } as unknown as Parameters<typeof validateCollateral>[0];
    expect(validateCollateral(input)).toBe("collateralRef is required");
  });

  it("rejects an over-long collateralRef", () => {
    expect(validateCollateral({ ...base, collateralRef: "x".repeat(MAX_REF_LENGTH + 1) })).toContain(
      "collateralRef must not exceed",
    );
  });

  it("accepts a collateralRef at the limit", () => {
    expect(validateCollateral({ ...base, collateralRef: "x".repeat(MAX_REF_LENGTH) })).toBeNull();
  });

  it("rejects a blank title", () => {
    expect(validateCollateral({ ...base, title: "" })).toBe("title is required");
  });

  it("rejects a non-string title", () => {
    const input = { ...base, title: null } as unknown as Parameters<typeof validateCollateral>[0];
    expect(validateCollateral(input)).toBe("title is required");
  });

  it("rejects an over-long title", () => {
    expect(validateCollateral({ ...base, title: "t".repeat(MAX_TITLE_LENGTH + 1) })).toContain(
      "title must not exceed",
    );
  });

  it("rejects a negative ordinal", () => {
    expect(validateCollateral({ ...base, ordinal: -1 })).toBe("ordinal must be a non-negative integer");
  });

  it("rejects a fractional ordinal", () => {
    expect(validateCollateral({ ...base, ordinal: 1.5 })).toBe("ordinal must be a non-negative integer");
  });

  it("rejects a NaN ordinal", () => {
    expect(validateCollateral({ ...base, ordinal: NaN })).toBe("ordinal must be a non-negative integer");
  });
});

describe("nextOrdinal", () => {
  it("starts at 0 for an empty deck", () => {
    expect(nextOrdinal([])).toBe(0);
  });

  it("returns one past the maximum", () => {
    expect(nextOrdinal([{ ordinal: 0 }, { ordinal: 4 }, { ordinal: 2 }])).toBe(5);
  });

  it("ignores non-finite ordinals", () => {
    expect(nextOrdinal([{ ordinal: NaN }, { ordinal: 1 }])).toBe(2);
  });

  it("handles a single entry", () => {
    expect(nextOrdinal([{ ordinal: 7 }])).toBe(8);
  });
});

describe("sortByOrdinal", () => {
  it("orders by ordinal ascending", () => {
    const sorted = sortByOrdinal([
      { id: "b", ordinal: 2 },
      { id: "a", ordinal: 1 },
    ]);
    expect(sorted.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("breaks ties on id ascending", () => {
    const sorted = sortByOrdinal([
      { id: "zebra", ordinal: 1 },
      { id: "alpha", ordinal: 1 },
    ]);
    expect(sorted.map((l) => l.id)).toEqual(["alpha", "zebra"]);
  });

  it("is deterministic regardless of input order", () => {
    const a = { id: "alpha", ordinal: 1 };
    const z = { id: "zebra", ordinal: 1 };
    expect(sortByOrdinal([a, z]).map((l) => l.id)).toEqual(sortByOrdinal([z, a]).map((l) => l.id));
  });

  it("treats a non-finite ordinal as 0", () => {
    const sorted = sortByOrdinal([{ id: "a", ordinal: 5 }, { id: "b", ordinal: NaN }]);
    expect(sorted.map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("does not mutate the input", () => {
    const links = [{ id: "b", ordinal: 2 }, { id: "a", ordinal: 1 }];
    const before = [...links];
    sortByOrdinal(links);
    expect(links).toEqual(before);
  });

  it("returns an empty array for empty input", () => {
    expect(sortByOrdinal([])).toEqual([]);
  });
});

// ── GET /v1/recommendations/:id/collateral ────────────────────────────────────

describe("GET /v1/recommendations/:id/collateral", () => {
  const url = `/v1/recommendations/${REC_ID}/collateral`;

  it("200 — returns the deck ordered by ordinal", async () => {
    H.listByRecommendationMock.mockResolvedValue({
      rows: [makeLink({ id: "l1", ordinal: 0 }), makeLink({ id: "l2", ordinal: 1 })],
      total: 2,
    });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.map((l: { ordinal: number }) => l.ordinal)).toEqual([0, 1]);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 50, total: 2 });
    await app.close();
  });

  it("200 — empty deck", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.json().data).toEqual([]);
    await app.close();
  });

  it("200 — computes the page from the offset", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=10&offset=30`, headers: auth() });
    expect(r.json().meta.page).toBe(4);
    await app.close();
  });

  it("400 — non-uuid recommendation id", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/not-a-uuid/collateral",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — limit above the maximum", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=500`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: strangerAuth() });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST /v1/recommendations/:id/collateral ───────────────────────────────────

describe("POST /v1/recommendations/:id/collateral", () => {
  const url = `/v1/recommendations/${REC_ID}/collateral`;

  it("202 — publishes an attach command", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: validPayload });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(H.queuePublishMock).toHaveBeenCalledOnce();
    // The route itself must not write.
    expect(H.insertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — assigns the next free ordinal", async () => {
    H.listAllForRecommendationMock.mockResolvedValue([{ ordinal: 0 }, { ordinal: 3 }]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: validPayload });
    expect((H.queuePublishMock.mock.calls[0]?.[1] as any).payload.ordinal).toBe(4);
    await app.close();
  });

  it("202 — honours an explicit ordinal", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...validPayload, ordinal: 9 },
    });
    expect((H.queuePublishMock.mock.calls[0]?.[1] as any).payload.ordinal).toBe(9);
    await app.close();
  });

  it("202 — a sales_user may attach", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(["sales_user"]),
      payload: validPayload,
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("404 — recommendation missing", async () => {
    H.nbaFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: validPayload });
    expect(r.statusCode).toBe(404);
    expect(H.queuePublishMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("400 — unknown collateralType", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...validPayload, collateralType: "webinar" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — collateralRef missing", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { collateralType: "document", title: "T" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — title blank", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...validPayload, title: "   " },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — negative ordinal", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...validPayload, ordinal: -1 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: validPayload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a read-only role cannot attach", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: readerAuth(), payload: validPayload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── DELETE /v1/recommendations/collateral/:linkId ─────────────────────────────

describe("DELETE /v1/recommendations/collateral/:linkId", () => {
  const url = `/v1/recommendations/collateral/${LINK_ID}`;

  it("202 — accepts detach", async () => {
    H.findByIdMock.mockResolvedValue(makeLink());
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url, headers: auth() });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(H.queuePublishMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("404 — link missing", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("202 — accepts detach when row exists", async () => {
    H.findByIdMock.mockResolvedValue(makeLink());
    H.deleteByIdMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url, headers: auth() });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("400 — non-uuid linkId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: "/v1/recommendations/collateral/nope",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a read-only role cannot detach", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url, headers: readerAuth() });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/collateral/types ──────────────────────────────────

describe("GET /v1/recommendations/collateral/types", () => {
  it("200 — lists the supported types", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/collateral/types",
      headers: readerAuth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.collateralTypes).toEqual([...COLLATERAL_TYPES]);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/recommendations/collateral/types" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/collateral/types",
      headers: strangerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── consumer ──────────────────────────────────────────────────────────────────

describe("handleAttachCollateral", () => {
  const msg = {
    messageId: "11111111-1111-4111-8111-111111111111",
    type: "recommendation.collateral.attach",
    tenantId: TENANT,
    actorId: USER,
    correlationId: "corr-1",
    timestamp: new Date().toISOString(),
    schemaVersion: "1.0",
    payload: {
      linkId: LINK_ID,
      recommendationId: REC_ID,
      collateralType: "document",
      collateralRef: "doc-1",
      title: "Doc",
      ordinal: 2,
    },
  };

  it("inserts the link and emits the audit event", async () => {
    await handleAttachCollateral(msg);
    expect(H.markProcessedMock).toHaveBeenCalledWith(expect.anything(), msg.messageId);
    expect(H.insertMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledTimes(2);
    expect(H.cacheInvalidateMock).toHaveBeenCalledOnce();
  });

  it("skips the write on redelivery (idempotency)", async () => {
    H.markProcessedMock.mockResolvedValue(false);
    await handleAttachCollateral(msg);
    expect(H.insertMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
  });

  it("marks the message processed before writing", async () => {
    const order: string[] = [];
    H.markProcessedMock.mockImplementation(async () => {
      order.push("markProcessed");
      return true;
    });
    H.insertMock.mockImplementation(async () => {
      order.push("insert");
    });
    await handleAttachCollateral(msg);
    expect(order).toEqual(["markProcessed", "insert"]);
  });

  it("carries the ordinal from the command payload", async () => {
    await handleAttachCollateral(msg);
    const written = H.insertMock.mock.calls[0]?.[1] as { ordinal: number };
    expect(written.ordinal).toBe(2);
  });
});
