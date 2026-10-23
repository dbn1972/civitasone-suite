import { describe, it, expect } from "vitest";

// CLOS2-S3-03: blocked storage (Safari "block all cookies", sandboxed iframes) throws
// SecurityError on mere access to window.localStorage.
describe("getOrCreateDeviceId with blocked storage", () => {
  it("returns a stable in-memory id instead of throwing", async () => {
    const { getOrCreateDeviceId } = await import("../src/device.js");
    const g = globalThis as Record<string, unknown>;
    const had = Object.getOwnPropertyDescriptor(g, "localStorage");
    Object.defineProperty(g, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    try {
      const a = getOrCreateDeviceId();
      const b = getOrCreateDeviceId();
      expect(a).toMatch(/^[0-9a-f-]{36}$/);
      expect(b).toBe(a);
    } finally {
      if (had) Object.defineProperty(g, "localStorage", had);
      else delete g.localStorage;
    }
  });

  it("returns a stable in-memory id when getItem/setItem throw", async () => {
    const { getOrCreateDeviceId } = await import("../src/device.js");
    const throwing = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    const a = getOrCreateDeviceId(throwing);
    expect(getOrCreateDeviceId(throwing)).toBe(a);
  });
});
