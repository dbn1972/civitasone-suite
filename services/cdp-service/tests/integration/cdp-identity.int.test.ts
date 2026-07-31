/**
 * cdp-identity.int.test.ts — REAL PostgreSQL integration test.
 *
 * The existing cdp tests mock `src/shared/db.js`, so the identity-graph and
 * merge SQL had never run. This file connects as the `cdp_svc` login role — NOT
 * as the superuser, because a superuser bypasses RLS and an admin-connected
 * isolation test proves nothing — and drives the ACTUAL repo functions.
 *
 * Covers: identity resolution by hash, profile merge (loser marked merged +
 * identity links reassigned to the winner), the unique index on
 * (tenant_id, identifier_type, identifier_hash), and real cross-tenant
 * isolation enforced by the `app.tenant_id` RLS policy.
 *
 * Skips (does not fail) when Postgres is unreachable so a machine without the
 * dev database still gets a green suite.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import type { ScopedTx } from "../../src/shared/db.js";

const EXPECTED_DB = "civitas_cdp";
const DEFAULT_DSN = `postgres://cdp_svc:cdp_dev_pw@localhost:5435/${EXPECTED_DB}`;
// `services/cdp-service/vitest.config.ts` supplies the right DSN. This guard
// stays as defence in depth: if the test is ever run through a config further up
// the tree (the repo-root one points DATABASE_URL at civitas_finance), only
// honour the inherited DSN when it actually addresses this service's database.
const inheritedDsn = process.env["DATABASE_URL"];
const DSN = inheritedDsn?.includes(EXPECTED_DB) === true ? inheritedDsn : DEFAULT_DSN;
// `src/shared/db.ts` builds its client at module-evaluation time from
// DATABASE_URL, so the value has to be in place BEFORE that module is imported.
// Hence the dynamic imports below — static imports would be hoisted above this.
process.env["DATABASE_URL"] = DSN;

/** Cheap connectivity probe on a throwaway client, used only to decide skip vs run. */
async function probe(): Promise<boolean> {
  const client = postgres(DSN, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

const reachable = await probe();

const { db, sqlClient } = await import("../../src/shared/db.js");
const { runWithTenant } = await import("@civitasone/db");
const profileRepo = await import("../../src/modules/profiles/repo.js");
const identityRepo = await import("../../src/modules/identity/repo.js");
const { profiles } = await import("../../src/modules/profiles/schema.js");
const { identityGraph } = await import("../../src/modules/identity/schema.js");

/** Two distinct tenants, unique per run so repeated runs never collide. */
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();

/** Every repo call goes through the tenant hook, which sets the app.tenant_id GUC. */
function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return Promise.resolve(runWithTenant(tenantId, fn));
}

function tx<T>(fn: (t: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

async function createProfile(tenantId: string, attributes: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  await asTenant(tenantId, () =>
    tx((t) =>
      profileRepo.insert(t, {
        id,
        tenantId,
        profileType: "individual",
        attributes,
        sourceLineage: [{ source: "integration-test", sourceId: id, timestamp: new Date().toISOString() }],
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    ),
  );
  return id;
}

async function linkIdentifier(
  tenantId: string,
  profileId: string,
  identifierType: string,
  identifierHash: string,
): Promise<string> {
  const id = randomUUID();
  await asTenant(tenantId, () =>
    tx((t) =>
      identityRepo.insert(t, {
        id,
        tenantId,
        profileId,
        identifierType,
        identifierHash,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    ),
  );
  return id;
}

describe.skipIf(!reachable)("cdp repo — real Postgres (identity resolution, merge, RLS)", () => {
  afterAll(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await asTenant(tenantId, () =>
        tx(async (t) => {
          await t.delete(identityGraph).where(eq(identityGraph.tenantId, tenantId));
          await t.delete(profiles).where(eq(profiles.tenantId, tenantId));
        }),
      ).catch(() => undefined);
    }
    await sqlClient.end({ timeout: 5 }).catch(() => undefined);
  });

  it("is connected to civitas_cdp as the non-superuser service role, so RLS is in force", async () => {
    const rows = await asTenant(TENANT_A, () =>
      tx((t) =>
        t.execute<{ db: string; who: string; is_super: boolean }>(
          sql`SELECT current_database() AS db, current_user AS who,
                     (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super`,
        ),
      ),
    );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    expect(row?.db).toBe(EXPECTED_DB);
    expect(row?.who).toBe("cdp_svc");
    // A superuser bypasses RLS entirely, which would make the isolation tests
    // below vacuous.
    expect(row?.is_super).toBe(false);
  });

  it("resolves a profile from either of its identifiers via findByHash", async () => {
    const profileId = await createProfile(TENANT_A, { name: "Asha" });
    const emailHash = `email-${randomUUID()}`;
    const phoneHash = `phone-${randomUUID()}`;

    await linkIdentifier(TENANT_A, profileId, "email", emailHash);
    await linkIdentifier(TENANT_A, profileId, "phone", phoneHash);

    const byEmail = await asTenant(TENANT_A, () => identityRepo.findByHash(emailHash, TENANT_A));
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0]?.profileId).toBe(profileId);
    expect(byEmail[0]?.identifierType).toBe("email");
    // numeric(5,4) confidence comes back as a string — no float rounding.
    expect(byEmail[0]?.confidence).toBe("1.0000");

    const byPhone = await asTenant(TENANT_A, () => identityRepo.findByHash(phoneHash, TENANT_A));
    expect(byPhone[0]?.profileId).toBe(profileId);

    const allLinks = await asTenant(TENANT_A, () => identityRepo.findByProfileId(profileId, TENANT_A));
    expect(allLinks).toHaveLength(2);
    expect(allLinks.map((l) => l.identifierType).sort()).toEqual(["email", "phone"]);

    const unknown = await asTenant(TENANT_A, () => identityRepo.findByHash(`missing-${randomUUID()}`, TENANT_A));
    expect(unknown).toEqual([]);
  });

  it("merges two profiles: loser is marked merged and its identity links move to the winner", async () => {
    const winnerId = await createProfile(TENANT_A, { name: "Ravi", email: "ravi@example.test" });
    const loserId = await createProfile(TENANT_A, { name: "Ravi K", phone: "+910000000000" });

    const winnerHash = `email-${randomUUID()}`;
    const loserHash1 = `phone-${randomUUID()}`;
    const loserHash2 = `device-${randomUUID()}`;
    await linkIdentifier(TENANT_A, winnerId, "email", winnerHash);
    await linkIdentifier(TENANT_A, loserId, "phone", loserHash1);
    await linkIdentifier(TENANT_A, loserId, "device_id", loserHash2);

    const before = await asTenant(TENANT_A, () => profileRepo.findById(winnerId, TENANT_A));
    expect(before?.version).toBe(1);

    await asTenant(TENANT_A, () =>
      tx(async (t) => {
        await profileRepo.markMerged(
          t,
          winnerId,
          loserId,
          TENANT_A,
          { name: "Ravi", email: "ravi@example.test", phone: "+910000000000" },
          [{ source: "merge", sourceId: loserId, timestamp: new Date().toISOString() }],
          [],
        );
        await identityRepo.reassignProfile(t, loserId, winnerId, TENANT_A);
      }),
    );

    const winner = await asTenant(TENANT_A, () => profileRepo.findById(winnerId, TENANT_A));
    expect(winner?.profileType).toBe("individual");
    expect(winner?.attributes).toMatchObject({ phone: "+910000000000" });
    expect(winner?.sourceLineage).toEqual([
      expect.objectContaining({ source: "merge", sourceId: loserId }),
    ]);
    // Version bump is computed by the DB (`version + 1`).
    expect(winner?.version).toBe(2);
    expect(winner?.mergedFromIds).toEqual([loserId]);

    const loser = await asTenant(TENANT_A, () => profileRepo.findById(loserId, TENANT_A));
    expect(loser?.profileType).toBe("merged");
    expect(loser?.attributes).toEqual({ mergedInto: winnerId });

    // The links actually moved — none left on the loser, all three on the winner.
    const loserLinks = await asTenant(TENANT_A, () => identityRepo.findByProfileId(loserId, TENANT_A));
    expect(loserLinks).toEqual([]);

    const winnerLinks = await asTenant(TENANT_A, () => identityRepo.findByProfileId(winnerId, TENANT_A));
    expect(winnerLinks).toHaveLength(3);
    expect(winnerLinks.map((l) => l.identifierHash).sort()).toEqual([winnerHash, loserHash1, loserHash2].sort());

    // Resolution now lands on the winner for a previously-loser identifier.
    const resolved = await asTenant(TENANT_A, () => identityRepo.findByHash(loserHash1, TENANT_A));
    expect(resolved[0]?.profileId).toBe(winnerId);
  });

  it("rejects a duplicate (tenant, identifier_type, identifier_hash) via the unique index", async () => {
    const profileId = await createProfile(TENANT_A, { name: "Dup" });
    const otherProfileId = await createProfile(TENANT_A, { name: "Dup 2" });
    const hash = `email-${randomUUID()}`;

    await linkIdentifier(TENANT_A, profileId, "email", hash);

    await expect(linkIdentifier(TENANT_A, otherProfileId, "email", hash)).rejects.toThrow(
      /uq_identity_graph_tenant_type_hash/,
    );

    // Same hash under a DIFFERENT identifier_type is allowed by the index.
    await expect(linkIdentifier(TENANT_A, otherProfileId, "phone", hash)).resolves.toBeTypeOf("string");

    // And the original link is untouched.
    const links = await asTenant(TENANT_A, () => identityRepo.findByProfileId(profileId, TENANT_A));
    expect(links).toHaveLength(1);
  });

  it("hides tenant A's profile from tenant B — RLS, not just the WHERE clause", async () => {
    const profileId = await createProfile(TENANT_A, { name: "Private to A" });

    // Visible to its own tenant.
    expect(await asTenant(TENANT_A, () => profileRepo.findById(profileId, TENANT_A))).not.toBeNull();

    // Through the repo (app-level filter + RLS): invisible to tenant B.
    expect(await asTenant(TENANT_B, () => profileRepo.findById(profileId, TENANT_B))).toBeNull();
    // Even when tenant B asks for the row by tenant A's id, which defeats the
    // application filter and leaves only RLS standing.
    expect(await asTenant(TENANT_B, () => profileRepo.findById(profileId, TENANT_A))).toBeNull();

    // Same query with NO tenant predicate at all: RLS alone decides.
    const seenByA = await asTenant(TENANT_A, () =>
      tx((t) => t.select().from(profiles).where(eq(profiles.id, profileId))),
    );
    expect(seenByA).toHaveLength(1);

    const seenByB = await asTenant(TENANT_B, () =>
      tx((t) => t.select().from(profiles).where(eq(profiles.id, profileId))),
    );
    expect(seenByB).toEqual([]);

    // Tenant B's own listing never contains it either.
    const listedByB = await asTenant(TENANT_B, () => profileRepo.listByTenant(TENANT_B, 50, 0));
    expect(listedByB.rows.map((r) => r.id)).not.toContain(profileId);
  });

  it("records the loser id in mergedFromIds as a plain jsonb array of uuids", async () => {
    // markMerged() used to append with
    //   sql`${profiles.mergedFromIds} || ${JSON.stringify([loserId])}::jsonb`
    // which the driver encoded a second time, storing ["[\"<loserId>\"]"] — an
    // unparseable uuid for anything reading the lineage. The value must be the
    // uuid itself, and it must survive a round-trip as a real jsonb array.
    const winnerId = await createProfile(TENANT_A, { name: "Lineage winner" });
    const loserId = await createProfile(TENANT_A, { name: "Lineage loser" });

    await asTenant(TENANT_A, () =>
      tx((t) => profileRepo.markMerged(t, winnerId, loserId, TENANT_A, { name: "Lineage winner" }, [], [])),
    );

    const winner = await asTenant(TENANT_A, () => profileRepo.findById(winnerId, TENANT_A));
    expect(winner?.mergedFromIds).toEqual([loserId]);
    expect(winner ? profileRepo.toView(winner).mergedFromIds : []).toEqual([loserId]);

    // Prove it is jsonb array-of-string in the column, not a nested string:
    // jsonb_array_elements_text unwraps to the bare uuid.
    const rows = await asTenant(TENANT_A, () =>
      tx((t) =>
        t.execute<{ raw: string; kind: string; elem: string }>(
          sql`SELECT merged_from_ids::text AS raw,
                     jsonb_typeof(merged_from_ids) AS kind,
                     jsonb_array_elements_text(merged_from_ids) AS elem
              FROM cdp.profiles WHERE id = ${winnerId}::uuid`,
        ),
      ),
    );
    const first = Array.isArray(rows) ? rows[0] : undefined;
    // A jsonb array of bare uuids, not a jsonb string wrapping one.
    expect(first?.kind).toBe("array");
    expect(first?.elem).toBe(loserId);
    expect(first?.raw).toBe(JSON.stringify([loserId]));
  });

  it("carries transitive lineage forward when the loser had itself absorbed profiles", async () => {
    // A merged-away profile's own lineage must not be dropped: merging B (which
    // had already absorbed C) into A has to leave A pointing at both B and C.
    const olderId = await createProfile(TENANT_A, { name: "Oldest" });
    const winnerId = await createProfile(TENANT_A, { name: "Transitive winner" });
    const loserId = await createProfile(TENANT_A, { name: "Transitive loser" });

    // The loser absorbed `olderId` in an earlier merge.
    await asTenant(TENANT_A, () =>
      tx((t) => profileRepo.markMerged(t, loserId, olderId, TENANT_A, { name: "Transitive loser" }, [], [])),
    );
    const loserBefore = await asTenant(TENANT_A, () => profileRepo.findById(loserId, TENANT_A));
    expect(loserBefore?.mergedFromIds).toEqual([olderId]);

    // Now merge the loser into the winner, exactly as the merge route does:
    // it forwards `loser.mergedFromIds`.
    await asTenant(TENANT_A, () =>
      tx((t) =>
        profileRepo.markMerged(
          t,
          winnerId,
          loserId,
          TENANT_A,
          { name: "Transitive winner" },
          [],
          loserBefore?.mergedFromIds ?? [],
        ),
      ),
    );

    const winner = await asTenant(TENANT_A, () => profileRepo.findById(winnerId, TENANT_A));
    expect(winner?.mergedFromIds).toHaveLength(2);
    expect(winner?.mergedFromIds).toEqual(expect.arrayContaining([loserId, olderId]));

    // Replaying the same merge is idempotent — no duplicate lineage entries.
    await asTenant(TENANT_A, () =>
      tx((t) =>
        profileRepo.markMerged(
          t,
          winnerId,
          loserId,
          TENANT_A,
          { name: "Transitive winner" },
          [],
          [olderId, loserId],
        ),
      ),
    );
    const replayed = await asTenant(TENANT_A, () => profileRepo.findById(winnerId, TENANT_A));
    expect(replayed?.mergedFromIds).toHaveLength(2);
    expect(new Set(replayed?.mergedFromIds)).toEqual(new Set([loserId, olderId]));
  });

  it("refuses to write a row belonging to another tenant (RLS WITH CHECK)", async () => {
    // The insert names tenant A while the GUC says tenant B — the policy's check
    // expression must reject it rather than let a tenant plant rows elsewhere.
    await expect(
      asTenant(TENANT_B, () =>
        tx((t) =>
          profileRepo.insert(t, {
            id: randomUUID(),
            tenantId: TENANT_A,
            profileType: "individual",
            attributes: { smuggled: true },
            createdBy: ACTOR,
            updatedBy: ACTOR,
          }),
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
