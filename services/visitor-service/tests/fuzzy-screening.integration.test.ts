/**
 * Integration test (Fix 3): fuzzy/alias screening REVIEW layer.
 *
 * Drives the REAL blacklist_entries / watchlist_entries tables (RLS-scoped
 * writes/reads via the visitor_svc pool) + the pg_trgm similarity() screen
 * (migration 0012) against the live DB. Proves the SECOND, non-blocking layer:
 *
 *   - a near-miss name ("Rajesh Kumar" vs blacklisted "Rajes Kumar") raises a
 *     REVIEW match (never an auto-deny);
 *   - a clean/unrelated name produces NO review match;
 *   - an exact-name active entry is still surfaced (similarity ~1.0);
 *   - the screen is RLS + tenant scoped — tenant B never sees tenant A's entry.
 *
 * The exact identity-document blind-index HARD-block is a separate, existing
 * layer (screening-store SISMEMBER, covered by blacklist-screening-store.test.ts)
 * and is unaffected by this additive fuzzy layer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { blacklistEntries, watchlistEntries } from "../src/modules/blacklist/schema.js";
import { fuzzyScreenName } from "../src/modules/blacklist/repo.js";
import { normalizeName } from "../src/modules/blacklist/domain.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const BL_A = randomUUID();
const WL_A = randomUUID();

async function insertBlacklist(tenant: string, id: string, name: string, status: string) {
  await runWithTenant(tenant, () =>
    db.transaction((tx) =>
      tx.insert(blacklistEntries).values({
        id, tenantId: tenant, personName: name, nameNormalized: normalizeName(name),
        reason: "test", status, createdBy: ACTOR, updatedBy: ACTOR,
      }),
    ),
  );
}

async function insertWatchlist(tenant: string, id: string, name: string, active: boolean) {
  await runWithTenant(tenant, () =>
    db.transaction((tx) =>
      tx.insert(watchlistEntries).values({
        id, tenantId: tenant, personName: name, nameNormalized: normalizeName(name),
        active, createdBy: ACTOR, updatedBy: ACTOR,
      }),
    ),
  );
}

const screen = (tenant: string, name: string) =>
  runWithTenant(tenant, () => fuzzyScreenName(tenant, name));

beforeAll(async () => {
  // Tenant A: an ACTIVE blacklisted "Rajes Kumar" + an ACTIVE watchlisted "Anita Roy".
  await insertBlacklist(TENANT_A, BL_A, "Rajes Kumar", "active");
  await insertWatchlist(TENANT_A, WL_A, "Anita Roy", true);
});

afterAll(async () => {
  await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.delete(blacklistEntries).where(eq(blacklistEntries.id, BL_A))));
  await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.delete(watchlistEntries).where(eq(watchlistEntries.id, WL_A))));
});

describe("normalizeName (pure)", () => {
  it("lowercases, strips punctuation/diacritics, collapses whitespace", () => {
    expect(normalizeName("Rajesh Kumar")).toBe("rajesh kumar");
    expect(normalizeName("  RAJESH   KUMAR!! ")).toBe("rajesh kumar");
    expect(normalizeName("José D'Souza")).toBe("jose d souza");
  });
});

describe("fuzzyScreenName — non-blocking review layer", () => {
  it("a near-miss name raises a REVIEW match against the blacklisted entry", async () => {
    const matches = await screen(TENANT_A, "Rajesh Kumar"); // vs blacklisted "Rajes Kumar"
    const bl = matches.find((m) => m.list === "blacklist");
    expect(bl).toBeDefined();
    expect(bl!.id).toBe(BL_A);
    expect(bl!.similarity).toBeGreaterThanOrEqual(0.45);
  });

  it("an exact-name active entry is still surfaced (similarity ~1.0)", async () => {
    const matches = await screen(TENANT_A, "Rajes Kumar");
    const bl = matches.find((m) => m.list === "blacklist");
    expect(bl).toBeDefined();
    expect(bl!.similarity).toBeGreaterThan(0.99);
  });

  it("a clean, unrelated name produces NO review match", async () => {
    const matches = await screen(TENANT_A, "Zoravar Singh");
    expect(matches).toHaveLength(0);
  });

  it("matches the watchlist too (alias variant of a watchlisted name)", async () => {
    const matches = await screen(TENANT_A, "Anitha Roy"); // vs watchlisted "Anita Roy"
    const wl = matches.find((m) => m.list === "watchlist");
    expect(wl).toBeDefined();
    expect(wl!.id).toBe(WL_A);
  });

  it("is tenant/RLS scoped — tenant B sees none of tenant A's listed entries", async () => {
    const matches = await screen(TENANT_B, "Rajesh Kumar");
    expect(matches).toHaveLength(0);
  });
});
