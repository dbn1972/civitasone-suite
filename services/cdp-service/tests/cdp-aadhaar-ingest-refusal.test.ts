/**
 * GAP-CDP-PROFILES-06 (owner decision D4c #1, 2026-10-27) — 12-digit Aadhaar-like
 * values are refused when customer data is received (Aadhaar Act, DPDP data
 * minimisation), instead of stored and only masked on read.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { findAadhaarLike } from "../src/shared/pii.js";

const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const TENANT = crypto.randomUUID();
const USER = crypto.randomUUID();
const PROFILE_ID = crypto.randomUUID();

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

const auth = (roles = ["cdp_user"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.publishMock.mockResolvedValue("m");
});

describe("findAadhaarLike", () => {
  it("finds a 12-digit value (plain, spaced, dashed) at any depth and names the path", () => {
    expect(findAadhaarLike({ idNo: "234567890123" })).toBe("idNo");
    expect(findAadhaarLike({ a: { b: ["2345 6789 0123"] } })).toBe("a.b.0");
    expect(findAadhaarLike({ x: "2345-6789-0123" })).toBe("x");
  });
  it("finds a value under an aadhaar-named key whatever its shape", () => {
    expect(findAadhaarLike({ aadhaarNumber: "last4 is 0123" })).toBe("aadhaarNumber");
    expect(findAadhaarLike({ aadhar_no: 5 })).toBe("aadhar_no");
  });
  it("treats uid as value-driven: refused only when 12-digit", () => {
    expect(findAadhaarLike({ uid: "234567890123" })).toBe("uid");
    expect(findAadhaarLike({ uid: "u-8f3a", device_uid: "d-1", uid2: 5 })).toBeNull();
  });
  it("does not flag ordinary attributes", () => {
    expect(findAadhaarLike({ name: "Raj", city: "Delhi", phone: "9876543210", pan: "ABCDE1234F", n: 42, t: "2025-06-01" })).toBeNull();
    expect(findAadhaarLike({ aadhaar: null })).toBeNull();
  });
});

describe("ingest refuses Aadhaar-like values (422, nothing published)", () => {
  it("POST /v1/cdp/profiles", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/profiles", headers: auth(),
      payload: { profileType: "individual", attributes: { name: "Raj", idNo: "234567890123" } },
    });
    expect(r.statusCode).toBe(422);
    expect(JSON.stringify(r.json())).not.toContain("234567890123");
    expect(H.publishMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("PATCH /v1/cdp/profiles/:id", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/cdp/profiles/${PROFILE_ID}`, headers: auth(),
      payload: { version: 1, attributes: { note: "2345 6789 0123" } },
    });
    expect(r.statusCode).toBe(422);
    expect(H.publishMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("POST /v1/cdp/events", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events", headers: auth(),
      payload: { profileId: PROFILE_ID, eventType: "kyc", payload: { aadhaar: "234567890123" }, occurredAt: "2025-06-01T10:00:00.000Z" },
    });
    expect(r.statusCode).toBe(422);
    expect(H.publishMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("POST /v1/cdp/events/ingest-batch rejects only the offending event", async () => {
    const app = await buildApp();
    const ok = { profileId: PROFILE_ID, eventType: "page_view", payload: { n: 1 }, occurredAt: "2025-06-01T10:00:00.000Z" };
    const bad = { ...ok, payload: { id: "234567890123" } };
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events/ingest-batch", headers: auth(),
      payload: { events: [ok, bad] },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.accepted).toBe(1);
    expect(r.json().data.rejected).toHaveLength(1);
    expect(r.json().data.rejected[0].index).toBe(1);
    expect(JSON.stringify(r.json())).not.toContain("234567890123");
    expect(H.publishMock).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
