/**
 * CDP-003 — near-real-time batch ingestion.
 * Asserts the contract that matters: a bad envelope is fatal (400), a bad event is not.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { MAX_INGEST_BATCH } from "../src/modules/events/ingest-routes.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({ publishMock: vi.fn() }));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn() }));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: vi.fn(() => "k") },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

const { buildApp } = await import("../src/app.js");

const URL = "/v1/cdp/events/ingest-batch";
const auth = (roles = ["cdp_user"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

const goodEvent = (i: number) => ({
  profileId: PROFILE_ID,
  eventType: "page_view",
  payload: { index: i },
  occurredAt: "2025-06-01T10:00:00.000Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  H.publishMock.mockResolvedValue("m");
});

describe("POST /v1/cdp/events/ingest-batch", () => {
  it("202 — accepts a batch and publishes one command per event", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: URL, headers: auth(),
      payload: { events: [goodEvent(0), goodEvent(1), goodEvent(2)], source: "web-collector" },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data).toEqual({ accepted: 3, rejected: [] });
    expect(H.publishMock).toHaveBeenCalledTimes(3);
    await app.close();
  });

  it("202 — forwards the batch source onto each command", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST", url: URL, headers: auth(),
      payload: { events: [goodEvent(0)], source: "umang-app" },
    });
    const published = H.publishMock.mock.calls[0]?.[1] as { payload: { source?: string } };
    expect(published.payload.source).toBe("umang-app");
    await app.close();
  });

  it("202 — a malformed event is reported by index, the rest are accepted", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: URL, headers: auth(),
      payload: {
        events: [
          goodEvent(0),
          { profileId: "not-a-uuid", eventType: "page_view", occurredAt: "2025-06-01T10:00:00.000Z" },
          { profileId: PROFILE_ID, occurredAt: "2025-06-01T10:00:00.000Z" },
          goodEvent(3),
        ],
      },
    });
    expect(r.statusCode).toBe(202);
    const body = r.json().data as { accepted: number; rejected: Array<{ index: number; reason: string }> };
    expect(body.accepted).toBe(2);
    expect(body.rejected.map((x) => x.index)).toEqual([1, 2]);
    expect(body.rejected[0]?.reason).toContain("profileId");
    expect(body.rejected[1]?.reason).toContain("eventType");
    expect(H.publishMock).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("202 — a publish failure is reported per index, not as a 500", async () => {
    H.publishMock
      .mockResolvedValueOnce("m")
      .mockRejectedValueOnce(new Error("broker unavailable"))
      .mockResolvedValueOnce("m");
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: URL, headers: auth(),
      payload: { events: [goodEvent(0), goodEvent(1), goodEvent(2)] },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.accepted).toBe(2);
    expect(r.json().data.rejected).toEqual([{ index: 1, reason: "broker unavailable" }]);
    await app.close();
  });

  it("202 — accepts a full batch at the 500 ceiling", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: URL, headers: auth(),
      payload: { events: Array.from({ length: MAX_INGEST_BATCH }, (_, i) => goodEvent(i)) },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.accepted).toBe(MAX_INGEST_BATCH);
    await app.close();
  });

  it("202 — reports every event when all of them are invalid", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: URL, headers: auth(), payload: { events: [{}, "nope", 7] },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.accepted).toBe(0);
    expect(r.json().data.rejected).toHaveLength(3);
    expect(H.publishMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("400 — envelope over the batch ceiling", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: URL, headers: auth(),
      payload: { events: Array.from({ length: MAX_INGEST_BATCH + 1 }, (_, i) => goodEvent(i)) },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — empty events array", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: URL, headers: auth(), payload: { events: [] } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — events is not an array", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: URL, headers: auth(), payload: { events: "one" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: URL, payload: { events: [goodEvent(0)] } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: URL, headers: auth(["viewer"]), payload: { events: [goodEvent(0)] },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
