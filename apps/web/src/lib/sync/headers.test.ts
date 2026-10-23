import { describe, it, expect, afterEach, vi } from "vitest";
import { buildSyncHeaders, getTrustToken, setTrustToken, clearTrustToken } from "./headers";

// CLOS2-S3-03: blocked storage must fail soft on the sync-header path too.
describe("sync headers with blocked storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds headers without throwing and omits the trust token", () => {
    const denied = {
      getItem() { throw new DOMException("denied", "SecurityError"); },
      setItem() { throw new DOMException("denied", "SecurityError"); },
      removeItem() { throw new DOMException("denied", "SecurityError"); },
    };
    vi.stubGlobal("localStorage", denied);
    vi.stubGlobal("sessionStorage", denied);
    expect(getTrustToken()).toBeUndefined();
    expect(() => setTrustToken("t")).not.toThrow();
    expect(() => clearTrustToken()).not.toThrow();
    const h = buildSyncHeaders();
    expect(h["x-device-id"]).toBeTruthy();
    expect(h["x-device-trust-token"]).toBeUndefined();
  });
});
