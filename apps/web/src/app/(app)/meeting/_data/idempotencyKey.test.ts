import { afterEach, describe, expect, it, vi } from "vitest";
import { idempotencyKey } from "./client";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("meeting idempotencyKey (CodeQL js/insecure-randomness)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses crypto.randomUUID when available", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
    expect(idempotencyKey()).toEqual({ "x-idempotency-key": "11111111-1111-4111-8111-111111111111" });
  });

  it("falls back to a getRandomValues-based v4 UUID, never Math.random", () => {
    const rnd = vi.spyOn(Math, "random");
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.fill(0xff) });
    const key = idempotencyKey()["x-idempotency-key"];
    expect(key).toMatch(UUID_V4);
    expect(rnd).not.toHaveBeenCalled();
  });

  it("refuses to mint a key without a secure random source", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => idempotencyKey()).toThrow(/secure random/);
  });
});
