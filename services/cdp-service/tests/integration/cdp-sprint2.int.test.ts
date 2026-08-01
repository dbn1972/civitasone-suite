/**
 * cdp-sprint2.int.test.ts — REAL PostgreSQL integration test for the Sprint 2 tables
 * (CDP-004/005/007/009/011/012).
 *
 * The route tests mock every repo, so none of the new SQL had ever executed: the
 * insert-select recompute, the ON CONFLICT upserts, the unique indexes, the CHECK
 * constraints and the numeric-as-string round-trip are only provable against a real
 * database. Connects as the `cdp_svc` login role — NOT the superuser, because a
 * superuser bypasses RLS and an admin-connected isolation test proves nothing.
 *
 * Skips (does not fail) when Postgres is unreachable so a machine without the dev
 * database still gets a green suite.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import type { ScopedTx } from "../../src/shared/db.js";

const EXPECTED_DB = "civitas_cdp";
const DEFAULT_DSN = `postgres://cdp_svc:cdp_dev_pw@localhost:5435/${EXPECTED_DB}`;
const inheritedDsn = process.env["DATABASE_URL"];
const DSN = inheritedDsn?.includes(EXPECTED_DB) === true ? inheritedDsn : DEFAULT_DSN;
// shared/db.ts builds its client at module-evaluation time, so the DSN has to be in
// place BEFORE that import — hence the dynamic imports below.
process.env["DATABASE_URL"] = DSN;

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
const scoresRepo = await import("../../src/modules/profiles/scores-repo.js");
const deviceRepo = await import("../../src/modules/identity/device-repo.js");
const taxonomyRepo = await import("../../src/modules/events/taxonomy-repo.js");
const segmentRepo = await import("../../src/modules/segments/repo.js");
const membershipRepo = await import("../../src/modules/segments/membership-repo.js");
const dsarRepo = await import("../../src/modules/dsar/repo.js");
const activationRepo = await import("../../src/modules/activations/repo.js");
const { profiles } = await import("../../src/modules/profiles/schema.js");
const { profileScores } = await import("../../src/modules/profiles/schema.js");
const { deviceTokens } = await import("../../src/modules/identity/schema.js");
const { eventTaxonomy } = await import("../../src/modules/events/schema.js");
const { segments, segmentMemberships } = await import("../../src/modules/segments/schema.js");
const { dsarRequests } = await import("../../src/modules/dsar/schema.js");
const { activations } = await import("../../src/modules/activations/schema.js");

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();

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
        id, tenantId, profileType: "individual", attributes,
        sourceLineage: [], createdBy: ACTOR, updatedBy: ACTOR,
      }),
    ),
  );
  return id;
}

async function createSegment(tenantId: string, criteria: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  await asTenant(tenantId, () =>
    tx((t) =>
      segmentRepo.insert(t, {
        id, tenantId, name: `seg-${id.slice(0, 8)}`, segmentType: "dynamic",
        criteria, status: "active", createdBy: ACTOR, updatedBy: ACTOR,
      }),
    ),
  );
  return id;
}

describe.skipIf(!reachable)("cdp sprint-2 repos — real Postgres", () => {
  afterAll(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await asTenant(tenantId, () =>
        tx(async (t) => {
          await t.delete(activations).where(eq(activations.tenantId, tenantId));
          await t.delete(dsarRequests).where(eq(dsarRequests.tenantId, tenantId));
          await t.delete(segmentMemberships).where(eq(segmentMemberships.tenantId, tenantId));
          await t.delete(deviceTokens).where(eq(deviceTokens.tenantId, tenantId));
          await t.delete(profileScores).where(eq(profileScores.tenantId, tenantId));
          await t.delete(eventTaxonomy).where(eq(eventTaxonomy.tenantId, tenantId));
          await t.delete(segments).where(eq(segments.tenantId, tenantId));
          await t.delete(profiles).where(eq(profiles.tenantId, tenantId));
        }),
      ).catch(() => undefined);
    }
    await sqlClient.end({ timeout: 5 }).catch(() => undefined);
  });

  // ── CDP-004 event_taxonomy ──────────────────────────────────────────────────

  it("registers, finds, filters and version-locks a taxonomy definition", async () => {
    const id = randomUUID();
    const eventName = `order_placed_${id.slice(0, 8)}`;

    await asTenant(TENANT_A, () =>
      tx((t) =>
        taxonomyRepo.insert(t, {
          id, tenantId: TENANT_A, eventName, category: "transactional",
          schemaJson: { orderId: { type: "string", required: true } },
          status: "draft", createdBy: ACTOR, updatedBy: ACTOR,
        }),
      ),
    );

    const byName = await asTenant(TENANT_A, () => taxonomyRepo.findByEventName(eventName, TENANT_A));
    expect(byName?.id).toBe(id);
    expect(byName?.status).toBe("draft");
    expect(byName?.schemaJson).toEqual({ orderId: { type: "string", required: true } });

    const byId = await asTenant(TENANT_A, () => taxonomyRepo.findById(id, TENANT_A));
    expect(byId?.eventName).toBe(eventName);
    expect(taxonomyRepo.toView(byId!).createdAt).toMatch(/^\d{4}-/);

    const drafts = await asTenant(TENANT_A, () => taxonomyRepo.listByTenant(TENANT_A, 50, 0, { status: "draft" }));
    expect(drafts.rows.map((r) => r.id)).toContain(id);
    const approved = await asTenant(TENANT_A, () => taxonomyRepo.listByTenant(TENANT_A, 50, 0, { status: "approved" }));
    expect(approved.rows.map((r) => r.id)).not.toContain(id);
    const byCategory = await asTenant(TENANT_A, () =>
      taxonomyRepo.listByTenant(TENANT_A, 50, 0, { category: "transactional" }),
    );
    expect(byCategory.total).toBeGreaterThan(0);

    // Approval bumps the version in the database, so the stale version is rejected.
    const ok = await asTenant(TENANT_A, () =>
      tx((t) => taxonomyRepo.update(t, id, TENANT_A, { status: "approved", updatedBy: ACTOR }, 1)),
    );
    expect(ok).toBe(true);
    const stale = await asTenant(TENANT_A, () =>
      tx((t) => taxonomyRepo.update(t, id, TENANT_A, { status: "deprecated", updatedBy: ACTOR }, 1)),
    );
    expect(stale).toBe(false);

    const after = await asTenant(TENANT_A, () => taxonomyRepo.findById(id, TENANT_A));
    expect(after?.status).toBe("approved");
    expect(after?.version).toBe(2);

    // Unknown name resolves to null rather than throwing.
    expect(await asTenant(TENANT_A, () => taxonomyRepo.findByEventName(`missing_${randomUUID()}`, TENANT_A))).toBeNull();
  });

  it("rejects a duplicate event name per tenant but allows it in another tenant", async () => {
    const eventName = `cart_abandoned_${randomUUID().slice(0, 8)}`;
    const insertFor = (tenantId: string) =>
      asTenant(tenantId, () =>
        tx((t) =>
          taxonomyRepo.insert(t, {
            id: randomUUID(), tenantId, eventName, category: "behavioural",
            schemaJson: {}, status: "draft", createdBy: ACTOR, updatedBy: ACTOR,
          }),
        ),
      );

    await insertFor(TENANT_A);
    await expect(insertFor(TENANT_A)).rejects.toThrow(/uq_event_taxonomy_tenant_name/);
    // The uniqueness is scoped to the tenant, not global.
    await expect(insertFor(TENANT_B)).resolves.toBeUndefined();
  });

  it("enforces the taxonomy status CHECK constraint", async () => {
    await expect(
      asTenant(TENANT_A, () =>
        tx((t) =>
          t.execute(sql`
            INSERT INTO cdp.event_taxonomy (tenant_id, event_name, category, status, created_by, updated_by)
            VALUES (${TENANT_A}::uuid, ${`bad_${randomUUID().slice(0, 8)}`}, 'behavioural', 'retired',
                    ${ACTOR}::uuid, ${ACTOR}::uuid)
          `),
        ),
      ),
    ).rejects.toThrow(/event_taxonomy_status_chk/);
  });

  // ── CDP-005 segment_memberships ─────────────────────────────────────────────

  it("materialises membership set-wise and drops rows that no longer match", async () => {
    const criteria = { conditions: [{ field: "attributes.city", operator: "eq", value: "Pune" }], logic: "and" as const };
    const segmentId = await createSegment(TENANT_A, criteria);
    const inPune1 = await createProfile(TENANT_A, { city: "Pune" });
    const inPune2 = await createProfile(TENANT_A, { city: "Pune" });
    const elsewhere = await createProfile(TENANT_A, { city: "Kochi" });

    const firstRun = new Date();
    const count = await asTenant(TENANT_A, () =>
      tx((t) => membershipRepo.recompute(t, TENANT_A, segmentId, criteria, firstRun)),
    );
    expect(count).toBe(2);

    const members = await asTenant(TENANT_A, () => membershipRepo.listMembers(segmentId, TENANT_A, 50, 0));
    expect(members.total).toBe(2);
    expect(members.rows.map((m) => m.profileId).sort()).toEqual([inPune1, inPune2].sort());
    expect(members.rows.every((m) => m.isRealtime === false)).toBe(true);
    expect(membershipRepo.toView(members.rows[0]!).computedAt).toMatch(/^\d{4}-/);
    expect(await asTenant(TENANT_A, () => membershipRepo.countMembers(segmentId, TENANT_A))).toBe(2);
    expect(await asTenant(TENANT_A, () => membershipRepo.countSegmentsForProfile(inPune1, TENANT_A))).toBe(1);
    expect(await asTenant(TENANT_A, () => membershipRepo.countSegmentsForProfile(elsewhere, TENANT_A))).toBe(0);

    // Re-running is idempotent: the ON CONFLICT branch refreshes rather than duplicating.
    const secondRun = new Date(firstRun.getTime() + 1000);
    expect(await asTenant(TENANT_A, () =>
      tx((t) => membershipRepo.recompute(t, TENANT_A, segmentId, criteria, secondRun)),
    )).toBe(2);
    const refreshed = await asTenant(TENANT_A, () => membershipRepo.listMembers(segmentId, TENANT_A, 50, 0));
    expect(refreshed.total).toBe(2);
    expect(refreshed.rows.every((m) => m.version >= 2)).toBe(true);

    // A profile that leaves the criteria is removed by the stale-stamp sweep.
    await asTenant(TENANT_A, () =>
      tx((t) => profileRepo.update(t, inPune2, TENANT_A, { attributes: { city: "Kochi" } }, 1)),
    );
    const thirdRun = new Date(firstRun.getTime() + 2000);
    expect(await asTenant(TENANT_A, () =>
      tx((t) => membershipRepo.recompute(t, TENANT_A, segmentId, criteria, thirdRun)),
    )).toBe(1);
    const finalMembers = await asTenant(TENANT_A, () => membershipRepo.listMembers(segmentId, TENANT_A, 50, 0));
    expect(finalMembers.rows.map((m) => m.profileId)).toEqual([inPune1]);
  });

  it("excludes merged profiles from a recompute", async () => {
    const criteria = { conditions: [{ field: "attributes.city", operator: "eq", value: "Nagpur" }], logic: "and" as const };
    const segmentId = await createSegment(TENANT_A, criteria);
    const winner = await createProfile(TENANT_A, { city: "Nagpur" });
    const loser = await createProfile(TENANT_A, { city: "Nagpur" });

    await asTenant(TENANT_A, () =>
      tx((t) => profileRepo.markMerged(t, winner, loser, TENANT_A, { city: "Nagpur" }, [], [])),
    );

    const count = await asTenant(TENANT_A, () =>
      tx((t) => membershipRepo.recompute(t, TENANT_A, segmentId, criteria, new Date())),
    );
    // The loser is profile_type='merged' and must not be activated to.
    expect(count).toBe(1);
  });

  it("rejects a second membership row for the same (segment, profile)", async () => {
    const segmentId = await createSegment(TENANT_A, {});
    const profileId = await createProfile(TENANT_A, { city: "Surat" });
    const insertRow = () =>
      asTenant(TENANT_A, () =>
        tx((t) =>
          t.insert(segmentMemberships).values({
            tenantId: TENANT_A, segmentId, profileId, computedAt: new Date(), isRealtime: true,
          }),
        ),
      );
    await insertRow();
    await expect(insertRow()).rejects.toThrow(/uq_segment_memberships_tenant_segment_profile/);
  });

  // ── CDP-007 device_tokens ───────────────────────────────────────────────────

  it("links, lists, counts and re-links a device token", async () => {
    const profileA = await createProfile(TENANT_A, { name: "Device owner" });
    const profileB = await createProfile(TENANT_A, { name: "New owner" });
    const token = `tok_${randomUUID().replace(/-/g, "")}`;
    const deviceId = randomUUID();

    await asTenant(TENANT_A, () =>
      tx((t) =>
        deviceRepo.insert(t, {
          id: deviceId, tenantId: TENANT_A, profileId: profileA,
          deviceToken: token, deviceType: "android", lastSeenAt: new Date(),
        }),
      ),
    );

    const found = await asTenant(TENANT_A, () => deviceRepo.findByToken(token, TENANT_A));
    expect(found?.id).toBe(deviceId);
    expect(found?.profileId).toBe(profileA);
    // The view never carries the raw token.
    expect(deviceRepo.toView(found!).tokenFingerprint).toBe(token.slice(-4));
    expect(JSON.stringify(deviceRepo.toView(found!))).not.toContain(token);

    const listed = await asTenant(TENANT_A, () => deviceRepo.listByProfile(profileA, TENANT_A, 50, 0));
    expect(listed.total).toBe(1);
    expect(await asTenant(TENANT_A, () => deviceRepo.countByProfile(profileA, TENANT_A))).toBe(1);

    // Re-link moves the device; the stale version is refused.
    const relinked = await asTenant(TENANT_A, () =>
      tx((t) => deviceRepo.relink(t, deviceId, TENANT_A, 1, {
        profileId: profileB, deviceType: "ios", lastSeenAt: new Date(),
      })),
    );
    expect(relinked).toBe(true);
    const stale = await asTenant(TENANT_A, () =>
      tx((t) => deviceRepo.relink(t, deviceId, TENANT_A, 1, {
        profileId: profileA, deviceType: "web", lastSeenAt: new Date(),
      })),
    );
    expect(stale).toBe(false);

    expect(await asTenant(TENANT_A, () => deviceRepo.countByProfile(profileA, TENANT_A))).toBe(0);
    expect(await asTenant(TENANT_A, () => deviceRepo.countByProfile(profileB, TENANT_A))).toBe(1);
    expect(await asTenant(TENANT_A, () => deviceRepo.findByToken(`tok_${randomUUID()}`, TENANT_A))).toBeNull();
  });

  it("rejects a duplicate device token within a tenant", async () => {
    const profileId = await createProfile(TENANT_A, { name: "Dup device" });
    const token = `tok_${randomUUID().replace(/-/g, "")}`;
    const insertRow = () =>
      asTenant(TENANT_A, () =>
        tx((t) =>
          deviceRepo.insert(t, {
            id: randomUUID(), tenantId: TENANT_A, profileId,
            deviceToken: token, deviceType: "web", lastSeenAt: new Date(),
          }),
        ),
      );
    await insertRow();
    await expect(insertRow()).rejects.toThrow(/uq_device_tokens_tenant_token/);
  });

  // ── CDP-009 profile_scores ──────────────────────────────────────────────────

  it("stores a score as exact numeric and returns it as a string", async () => {
    const profileId = await createProfile(TENANT_A, { name: "Scored" });
    const scoreId = randomUUID();

    await asTenant(TENANT_A, () =>
      tx((t) =>
        scoresRepo.insert(t, {
          id: scoreId, tenantId: TENANT_A, profileId, scoreType: "churn_risk",
          score: "0.8125", modelVersion: "churn-v3", computedAt: new Date(),
        }),
      ),
    );

    const found = await asTenant(TENANT_A, () => scoresRepo.findByType(profileId, TENANT_A, "churn_risk"));
    // numeric(6,4) round-trips as text — no binary-float drift.
    expect(found?.score).toBe("0.8125");
    expect(typeof found?.score).toBe("string");
    expect(typeof scoresRepo.toView(found!).score).toBe("string");

    const updated = await asTenant(TENANT_A, () =>
      tx((t) => scoresRepo.updateScore(t, scoreId, TENANT_A, 1, {
        score: "0.4200", modelVersion: "churn-v4", computedAt: new Date(),
      })),
    );
    expect(updated).toBe(true);
    const stale = await asTenant(TENANT_A, () =>
      tx((t) => scoresRepo.updateScore(t, scoreId, TENANT_A, 1, {
        score: "0.9900", modelVersion: "churn-v5", computedAt: new Date(),
      })),
    );
    expect(stale).toBe(false);

    const after = await asTenant(TENANT_A, () => scoresRepo.findByType(profileId, TENANT_A, "churn_risk"));
    expect(after?.score).toBe("0.4200");
    expect(after?.version).toBe(2);

    await asTenant(TENANT_A, () =>
      tx((t) =>
        scoresRepo.insert(t, {
          id: randomUUID(), tenantId: TENANT_A, profileId, scoreType: "clv_band",
          score: "12.5000", modelVersion: "clv-v1", computedAt: new Date(),
        }),
      ),
    );
    const listed = await asTenant(TENANT_A, () => scoresRepo.listByProfile(profileId, TENANT_A, 50, 0));
    expect(listed.total).toBe(2);
    expect(listed.rows.map((s) => s.score).sort()).toEqual(["0.4200", "12.5000"]);
    expect(await asTenant(TENANT_A, () => scoresRepo.countByProfile(profileId, TENANT_A))).toBe(2);
    expect(await asTenant(TENANT_A, () => scoresRepo.findByType(profileId, TENANT_A, "no_such_score"))).toBeNull();
  });

  it("rejects a second score of the same type for one profile", async () => {
    const profileId = await createProfile(TENANT_A, { name: "Dup score" });
    const insertRow = () =>
      asTenant(TENANT_A, () =>
        tx((t) =>
          scoresRepo.insert(t, {
            id: randomUUID(), tenantId: TENANT_A, profileId, scoreType: "propensity",
            score: "0.5000", modelVersion: "v1", computedAt: new Date(),
          }),
        ),
      );
    await insertRow();
    await expect(insertRow()).rejects.toThrow(/uq_profile_scores_tenant_profile_type/);
  });

  // ── CDP-011 dsar_requests ───────────────────────────────────────────────────

  it("registers, filters and completes a DSAR under optimistic locking", async () => {
    const profileId = await createProfile(TENANT_A, { name: "Data subject" });
    const id = randomUUID();

    await asTenant(TENANT_A, () =>
      tx((t) =>
        dsarRepo.insert(t, {
          id, tenantId: TENANT_A, profileId, requestType: "erasure",
          status: "pending", reason: "citizen request",
        }),
      ),
    );

    const found = await asTenant(TENANT_A, () => dsarRepo.findById(id, TENANT_A));
    expect(found?.requestType).toBe("erasure");
    expect(found?.completedAt).toBeNull();
    expect(dsarRepo.toView(found!).completedAt).toBeNull();

    const pending = await asTenant(TENANT_A, () => dsarRepo.listByTenant(TENANT_A, 50, 0, { status: "pending" }));
    expect(pending.rows.map((r) => r.id)).toContain(id);
    const byProfile = await asTenant(TENANT_A, () => dsarRepo.listByTenant(TENANT_A, 50, 0, { profileId }));
    expect(byProfile.total).toBe(1);
    const completedBefore = await asTenant(TENANT_A, () =>
      dsarRepo.listByTenant(TENANT_A, 50, 0, { status: "completed" }),
    );
    expect(completedBefore.rows.map((r) => r.id)).not.toContain(id);

    const completedAt = new Date();
    expect(await asTenant(TENANT_A, () => tx((t) => dsarRepo.complete(t, id, TENANT_A, 1, completedAt)))).toBe(true);
    // A replayed completion cannot fire a second purge event.
    expect(await asTenant(TENANT_A, () => tx((t) => dsarRepo.complete(t, id, TENANT_A, 1, completedAt)))).toBe(false);

    const after = await asTenant(TENANT_A, () => dsarRepo.findById(id, TENANT_A));
    expect(after?.status).toBe("completed");
    expect(after?.version).toBe(2);
    expect(dsarRepo.toView(after!).completedAt).not.toBeNull();
  });

  it("enforces the DSAR type and status CHECK constraints", async () => {
    const profileId = await createProfile(TENANT_A, { name: "Check subject" });

    await expect(
      asTenant(TENANT_A, () =>
        tx((t) =>
          t.execute(sql`
            INSERT INTO cdp.dsar_requests (tenant_id, profile_id, request_type, status)
            VALUES (${TENANT_A}::uuid, ${profileId}::uuid, 'forgetting', 'pending')
          `),
        ),
      ),
    ).rejects.toThrow(/dsar_requests_type_chk/);

    await expect(
      asTenant(TENANT_A, () =>
        tx((t) =>
          t.execute(sql`
            INSERT INTO cdp.dsar_requests (tenant_id, profile_id, request_type, status)
            VALUES (${TENANT_A}::uuid, ${profileId}::uuid, 'erasure', 'lost')
          `),
        ),
      ),
    ).rejects.toThrow(/dsar_requests_status_chk/);
  });

  // ── CDP-012 activations ─────────────────────────────────────────────────────

  it("records an activation run and advances its status under optimistic locking", async () => {
    const segmentId = await createSegment(TENANT_A, {});
    const id = randomUUID();

    await asTenant(TENANT_A, () =>
      tx((t) =>
        activationRepo.insert(t, {
          id, tenantId: TENANT_A, segmentId, channel: "whatsapp",
          status: "pending", audienceCount: 42, startedAt: new Date(),
        }),
      ),
    );

    const found = await asTenant(TENANT_A, () => activationRepo.findById(id, TENANT_A));
    expect(found?.channel).toBe("whatsapp");
    expect(found?.audienceCount).toBe(42);
    expect(activationRepo.toView(found!).completedAt).toBeNull();

    const byChannel = await asTenant(TENANT_A, () =>
      activationRepo.listByTenant(TENANT_A, 50, 0, { channel: "whatsapp", status: "pending" }),
    );
    expect(byChannel.rows.map((r) => r.id)).toContain(id);
    const bySegment = await asTenant(TENANT_A, () =>
      activationRepo.listByTenant(TENANT_A, 50, 0, { segmentId }),
    );
    expect(bySegment.total).toBe(1);
    const otherChannel = await asTenant(TENANT_A, () =>
      activationRepo.listByTenant(TENANT_A, 50, 0, { channel: "sms" }),
    );
    expect(otherChannel.rows.map((r) => r.id)).not.toContain(id);

    expect(await asTenant(TENANT_A, () =>
      tx((t) => activationRepo.updateStatus(t, id, TENANT_A, 1, {
        status: "completed", completedAt: new Date(), audienceCount: 40,
      })),
    )).toBe(true);
    expect(await asTenant(TENANT_A, () =>
      tx((t) => activationRepo.updateStatus(t, id, TENANT_A, 1, { status: "failed" })),
    )).toBe(false);

    const after = await asTenant(TENANT_A, () => activationRepo.findById(id, TENANT_A));
    expect(after?.status).toBe("completed");
    expect(after?.audienceCount).toBe(40);
    expect(after?.version).toBe(2);
  });

  it("enforces the activation channel and status CHECK constraints", async () => {
    const segmentId = await createSegment(TENANT_A, {});

    await expect(
      asTenant(TENANT_A, () =>
        tx((t) =>
          t.execute(sql`
            INSERT INTO cdp.activations (tenant_id, segment_id, channel, status)
            VALUES (${TENANT_A}::uuid, ${segmentId}::uuid, 'fax', 'pending')
          `),
        ),
      ),
    ).rejects.toThrow(/activations_channel_chk/);

    await expect(
      asTenant(TENANT_A, () =>
        tx((t) =>
          t.execute(sql`
            INSERT INTO cdp.activations (tenant_id, segment_id, channel, status)
            VALUES (${TENANT_A}::uuid, ${segmentId}::uuid, 'umang', 'exploded')
          `),
        ),
      ),
    ).rejects.toThrow(/activations_status_chk/);
  });

  // ── RLS on the new tables ───────────────────────────────────────────────────

  it("hides the new tables' rows across tenants — RLS, not just the WHERE clause", async () => {
    const profileId = await createProfile(TENANT_A, { name: "RLS subject" });
    const dsarId = randomUUID();
    await asTenant(TENANT_A, () =>
      tx((t) =>
        dsarRepo.insert(t, {
          id: dsarId, tenantId: TENANT_A, profileId, requestType: "access", status: "pending", reason: null,
        }),
      ),
    );

    // Visible to its own tenant.
    expect(await asTenant(TENANT_A, () => dsarRepo.findById(dsarId, TENANT_A))).not.toBeNull();
    // Invisible to tenant B even when it asks using tenant A's ids, which defeats the
    // application filter and leaves only RLS standing.
    expect(await asTenant(TENANT_B, () => dsarRepo.findById(dsarId, TENANT_A))).toBeNull();

    const seenByB = await asTenant(TENANT_B, () =>
      tx((t) => t.select().from(dsarRequests).where(eq(dsarRequests.id, dsarId))),
    );
    expect(seenByB).toEqual([]);

    // And a tenant cannot plant a row belonging to another tenant (policy WITH CHECK).
    await expect(
      asTenant(TENANT_B, () =>
        tx((t) =>
          dsarRepo.insert(t, {
            id: randomUUID(), tenantId: TENANT_A, profileId, requestType: "access", status: "pending", reason: null,
          }),
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
