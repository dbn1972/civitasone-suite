import { describe, it, expect } from "vitest";
import {
  shouldRetry, backoffMs, foldExchangeResult, reconcile, DEFAULT_MAX_ATTEMPTS,
} from "../src/modules/gem/reconcile-domain.js";

describe("SVC-050 GeM/CPPP domain — retry policy", () => {
  it("retries pending/failed refs with attempts remaining", () => {
    expect(shouldRetry("pending", 0)).toBe(true);
    expect(shouldRetry("failed", 2)).toBe(true);
    expect(shouldRetry("pending", DEFAULT_MAX_ATTEMPTS)).toBe(false);
  });

  it("never retries terminal acked/reconciled refs", () => {
    expect(shouldRetry("acked", 0)).toBe(false);
    expect(shouldRetry("reconciled", 0)).toBe(false);
  });

  it("backoff grows exponentially and caps at 5 min", () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(30)).toBe(300000);
  });
});

describe("SVC-050 GeM/CPPP domain — exchange result folding", () => {
  it("success → sent with external ref/status", () => {
    const o = foldExchangeResult(0, { ok: true, externalRef: "GEM-REF-1", externalStatus: "placed" });
    expect(o.status).toBe("sent");
    expect(o.attempts).toBe(1);
    expect(o.externalRef).toBe("GEM-REF-1");
    expect(o.lastError).toBeNull();
  });

  it("failure stays pending while attempts remain, records error", () => {
    const o = foldExchangeResult(0, { ok: false, error: "PROVIDER_ERROR" });
    expect(o.status).toBe("pending");
    expect(o.attempts).toBe(1);
    expect(o.lastError).toBe("PROVIDER_ERROR");
  });

  it("failure becomes failed once attempts are exhausted", () => {
    const o = foldExchangeResult(DEFAULT_MAX_ATTEMPTS - 1, { ok: false, error: "CIRCUIT_OPEN" });
    expect(o.status).toBe("failed");
    expect(o.attempts).toBe(DEFAULT_MAX_ATTEMPTS);
  });
});

describe("SVC-050 GeM/CPPP domain — reconciliation (no fake success)", () => {
  it("terminal-accepted external status → reconciled", () => {
    for (const s of ["accepted", "CONFIRMED", "placed", "awarded"]) {
      const r = reconcile(s);
      expect(r.reconciled).toBe(true);
      expect(r.status).toBe("reconciled");
    }
  });

  it("rejected external status → failed + discrepancy", () => {
    const r = reconcile("rejected");
    expect(r.status).toBe("failed");
    expect(r.discrepancy).toBe(true);
  });

  it("unknown / empty external status is NOT reconciled (honest)", () => {
    expect(reconcile("").reconciled).toBe(false);
    expect(reconcile(null).reconciled).toBe(false);
    expect(reconcile("in_progress").reconciled).toBe(false);
    expect(reconcile("in_progress").status).toBe("acked");
  });
});
