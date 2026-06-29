/**
 * R17 — federated (CVC / government-wide) vendor debarment.
 *
 * A central debarment recorded against a firm's PAN must block that PAN in
 * EVERY tenant — not just the authority that recorded it. A tenant-scoped
 * blacklist row must NOT leak into the central check.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { vendorBlacklist } from "../src/modules/vendor-blacklist/schema.js";
import * as repo from "../src/modules/vendor-blacklist/repo.js";

const TENANT_A = "3c000000-aaaa-4000-8000-0000000000f1";
const TENANT_B = "3c000000-bbbb-4000-8000-0000000000f1";
const PAN = "ABCDE1234F";
const OTHER_PAN = "ZZZZZ9999Z";

async function clean() {
  await db.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, TENANT_A));
  await db.delete(vendorBlacklist).where(eq(vendorBlacklist.tenantId, TENANT_B));
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("federated central debarment (R17)", () => {
  it("a central debarment recorded by tenant A blocks the PAN for tenant B", async () => {
    await repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: "00000000-0000-0000-0000-000000000000",
      scope: "central", pan: PAN, reason: "CVC debarment order 42",
      blacklistedBy: randomUUID(), createdBy: randomUUID(),
      blacklistedFrom: "2026-01-01", status: "active",
    });
    // The check is tenant-agnostic — any tenant's vendor with this PAN is blocked.
    expect(await repo.isCentrallyDebarredTx(db, PAN)).toBe(true);
    expect(await repo.findActiveCentralByPan(PAN)).not.toBeNull();
  });

  it("is case-insensitive on PAN", async () => {
    await repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: "00000000-0000-0000-0000-000000000000",
      scope: "central", pan: PAN, reason: "CVC order", blacklistedBy: randomUUID(),
      createdBy: randomUUID(), blacklistedFrom: "2026-01-01", status: "active",
    });
    expect(await repo.isCentrallyDebarredTx(db, PAN.toLowerCase())).toBe(true);
  });

  it("does not block a different PAN", async () => {
    await repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: "00000000-0000-0000-0000-000000000000",
      scope: "central", pan: PAN, reason: "CVC order", blacklistedBy: randomUUID(),
      createdBy: randomUUID(), blacklistedFrom: "2026-01-01", status: "active",
    });
    expect(await repo.isCentrallyDebarredTx(db, OTHER_PAN)).toBe(false);
    expect(await repo.isCentrallyDebarredTx(db, null)).toBe(false);
  });

  it("a tenant-scoped blacklist row does NOT count as a central debarment", async () => {
    await repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: randomUUID(),
      scope: "tenant", pan: PAN, reason: "local blacklist", blacklistedBy: randomUUID(),
      createdBy: randomUUID(), blacklistedFrom: "2026-01-01", status: "active",
    });
    expect(await repo.isCentrallyDebarredTx(db, PAN)).toBe(false);
  });

  it("a reinstated central debarment no longer blocks", async () => {
    await repo.insertBlacklist({
      tenantId: TENANT_A, vendorId: "00000000-0000-0000-0000-000000000000",
      scope: "central", pan: PAN, reason: "CVC order", blacklistedBy: randomUUID(),
      createdBy: randomUUID(), blacklistedFrom: "2026-01-01", status: "reinstated",
    });
    expect(await repo.isCentrallyDebarredTx(db, PAN)).toBe(false);
  });
});
