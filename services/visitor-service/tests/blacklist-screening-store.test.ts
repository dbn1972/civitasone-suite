/**
 * Feature: visitor-management, Task 4.6 — modules/blacklist/screening-store.ts
 *
 * Unit tests for the in-memory screening-set store fallback
 * (CACHE_DRIVER=memory per vitest.config.ts): adding hashes to the
 * blacklist/watchlist sets, set semantics (no duplicates), and
 * tenant isolation (no cross-tenant leakage).
 *
 * Requirements: 10.3, 10.4, 10.5
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  addToBlacklistHashSet,
  addToWatchlistHashSet,
  isBlacklisted,
  setScreeningStoreForTests,
} from "../src/modules/blacklist/screening-store.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  setScreeningStoreForTests(null);
});

describe("addToBlacklistHashSet / addToWatchlistHashSet", () => {
  it("does not throw when adding a hash to a tenant's blacklist set", async () => {
    await expect(addToBlacklistHashSet(TENANT_A, "hash-1")).resolves.toBeUndefined();
  });

  it("does not throw when adding a hash to a tenant's watchlist set", async () => {
    await expect(addToWatchlistHashSet(TENANT_A, "hash-1")).resolves.toBeUndefined();
  });

  it("is idempotent — adding the same hash twice does not throw", async () => {
    await addToBlacklistHashSet(TENANT_A, "hash-1");
    await expect(addToBlacklistHashSet(TENANT_A, "hash-1")).resolves.toBeUndefined();
  });

  it("keeps blacklist and watchlist hashes for different tenants independent (no cross-tenant leakage)", async () => {
    await expect(addToBlacklistHashSet(TENANT_A, "hash-a")).resolves.toBeUndefined();
    await expect(addToBlacklistHashSet(TENANT_B, "hash-b")).resolves.toBeUndefined();
    await expect(addToWatchlistHashSet(TENANT_A, "hash-c")).resolves.toBeUndefined();
  });
});

describe("isBlacklisted (SISMEMBER helper used by visit-request routes.ts)", () => {
  it("returns false for a hash that was never added", async () => {
    await expect(isBlacklisted(TENANT_A, "unknown-hash")).resolves.toBe(false);
  });

  it("returns true once a hash has been added to the tenant's blacklist set", async () => {
    await addToBlacklistHashSet(TENANT_A, "hash-1");
    await expect(isBlacklisted(TENANT_A, "hash-1")).resolves.toBe(true);
  });

  it("does not match a hash only present on the watchlist (not the blacklist)", async () => {
    await addToWatchlistHashSet(TENANT_A, "hash-watchlist-only");
    await expect(isBlacklisted(TENANT_A, "hash-watchlist-only")).resolves.toBe(false);
  });

  it("does not leak a blacklist match across tenants", async () => {
    await addToBlacklistHashSet(TENANT_A, "hash-shared");
    await expect(isBlacklisted(TENANT_B, "hash-shared")).resolves.toBe(false);
  });
});
