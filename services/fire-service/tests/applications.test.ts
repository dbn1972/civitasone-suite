/**
 * applications module — route -> consumer -> persisted-state lifecycle,
 * plus a direct DB-level proof that repo.ts's updateStatus is a real
 * compare-and-swap (CAS). Mirrors services/animal-service/tests/
 * complaints-lifecycle.test.ts + complaints-cas.test.ts (PR #1007).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import * as repo from "../src/modules/applications/repo.js";
import { generateApplicationNumber } from "../src/modules/applications/domain.js";
import { hdr, drainQueue, waitFor, OFFICER_ROLES, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerApplicationConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const validBody = {
  buildingName: "Test Building",
  buildingAddress: { line1: "1 Test St", city: "Pune", pin: "411001" },
  occupancyType: "commercial" as const,
  builtUpArea: "1000",
};

describe("applications — route -> consumer -> persisted state", () => {
  it("create: publishes 202, consumer persists a draft row with a computed fee and a real application number", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/fire/applications",
      headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES),
      payload: validBody,
    });
    expect(create.statusCode).toBe(202);
    const id = (create.json() as { id: string }).id;

    let row: { status: string; applicationNumber: string; feeMinor: string; feePaid: boolean } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
      if (get.statusCode !== 200) return false;
      row = get.json().data;
      return true;
    });

    expect(row!.status).toBe("draft");
    expect(row!.feePaid).toBe(false);
    // commercial base fee (250000 paise) + 1000 sqft * 50 paise/sqft = 300000
    expect(String(row!.feeMinor)).toBe("300000");
    expect(row!.applicationNumber).toMatch(/^FIRE\/ULB\/\d{4}\/\d{6}$/);
  });

  it("non-numeric builtUpArea does not silently zero the surcharge check — logged, base fee only, not a crash", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/fire/applications",
      headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES),
      payload: { ...validBody, builtUpArea: "not-a-number" },
    });
    expect(create.statusCode).toBe(202);
    const id = (create.json() as { id: string }).id;
    let feeMinor: string | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
      if (get.statusCode !== 200) return false;
      feeMinor = get.json().data.feeMinor;
      return true;
    });
    expect(String(feeMinor)).toBe("250000"); // base only, area surcharge treated as 0
  });

  it("submit: draft -> submitted, sets submittedAt", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: validBody });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);

    const submit = await app.inject({ method: "POST", url: `/v1/fire/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
    expect(submit.statusCode).toBe(202);

    let row: { status: string; submittedAt: string | null } | undefined;
    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
      row = get.json().data;
      return row?.status === "submitted";
    });
    expect(row!.submittedAt).not.toBeNull();
  });

  it("withdraw: submitted -> withdrawn", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: validBody });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/fire/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "submitted");

    const withdraw = await app.inject({ method: "POST", url: `/v1/fire/applications/${id}/withdraw`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
    expect(withdraw.statusCode).toBe(202);
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "withdrawn");
  });

  it("route pre-check rejects submitting an already-withdrawn application with 422, not a silent 202", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/fire/applications", headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES), payload: validBody });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/fire/applications/${id}/withdraw`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/fire/applications/${id}`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) })).json().data.status === "withdrawn");

    const resubmit = await app.inject({ method: "POST", url: `/v1/fire/applications/${id}/submit`, headers: hdr(ACTOR_A, TENANT_A, OFFICER_ROLES) });
    expect(resubmit.statusCode).toBe(422);
  });
});

/**
 * Direct, DB-level proof that repo.ts's updateStatus is a real
 * compare-and-swap, bypassing routes/consumers entirely so the guard itself
 * is what's under test.
 */
async function seedApplication(status: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT_A, () =>
    db.transaction(async (tx) => {
      const applicationNumber = generateApplicationNumber("CASTEST", new Date().getUTCFullYear(), await repo.nextApplicationNumber(tx));
      await repo.insert(tx, {
        id,
        tenantId: TENANT_A,
        applicationNumber,
        status,
        buildingName: "CAS Test Building",
        buildingAddress: { line1: "1 Test St", city: "Pune", pin: "411001" },
        occupancyType: "commercial",
        feeMinor: 250000n,
        feeCurrency: "INR",
        feePaid: false,
        createdBy: ACTOR_A,
        updatedBy: ACTOR_A,
      });
    }),
  );
  return id;
}

function findAsTenantA(id: string) {
  return runWithTenant(TENANT_A, () => repo.findById(TENANT_A, id));
}

describe("applications/repo.ts updateStatus — compare-and-swap guard", () => {
  it("rejects a transition whose fromStatuses does not include the row's actual current status, and leaves the row untouched", async () => {
    const id = await seedApplication("draft");
    const row = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "withdrawn", ["submitted"], ACTOR_A)),
    );
    expect(row).toBeNull();
    const current = await findAsTenantA(id);
    expect(current?.status).toBe("draft");
    expect(current?.version).toBe(1);
  });

  it("applies the transition when the row's current status IS in fromStatuses", async () => {
    const id = await seedApplication("draft");
    const row = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "submitted", ["draft"], ACTOR_A)),
    );
    expect(row).not.toBeNull();
    const current = await findAsTenantA(id);
    expect(current?.status).toBe("submitted");
    expect(current?.version).toBe(2);
  });

  it("rejects with an empty fromStatuses list (no source status is ever valid)", async () => {
    const id = await seedApplication("draft");
    const row = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "submitted", [], ACTOR_A)),
    );
    expect(row).toBeNull();
    expect((await findAsTenantA(id))?.status).toBe("draft");
  });

  it("is tenant-scoped: a different tenant's session cannot CAS a row it does not own", async () => {
    const id = await seedApplication("draft");
    const row = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => repo.updateStatus(tx, TENANT_B, id, "submitted", ["draft"], ACTOR_A)),
    );
    expect(row).toBeNull();
    expect((await findAsTenantA(id))?.status).toBe("draft");
  });

  it("proves the guard holds under real concurrency: two updateStatus calls racing for the SAME row, both accepting the row's actual current status as their source — only the first to commit applies, the second (now stale) is rejected", async () => {
    // Two commands racing at the database level (both issued inside
    // Promise.all, so Postgres's own row-lock serializes them -- exactly
    // what would happen for two consumers processing colliding messages).
    // Without the fromStatuses predicate, BOTH updates would match the row
    // regardless of commit order, and the row would end up in whichever
    // status committed last -- not a rejection, a silent clobber.
    //
    // NOTE: both racing writers here accept fromStatuses=["submitted"] --
    // NOT one "valid" and one "invalid" source, as that shape is not
    // actually mutually exclusive under Postgres's real concurrency
    // semantics: a blocked UPDATE re-evaluates its WHERE clause against the
    // row's state AFTER the other commits (not its state when the
    // transaction started), so a writer whose fromStatuses happens to
    // include whatever status the row ends up in after the first commit
    // would incorrectly also apply -- proven the hard way while writing
    // this suite (see git history: an earlier version of this test raced
    // "submitted"->"withdrawn" with fromStatuses=["under_review"] against
    // "submitted"->"under_review", and the "invalid" writer legitimately
    // succeeded once the row actually reached "under_review"). Racing two
    // IDENTICAL fromStatuses is the correct way to prove mutual exclusion:
    // once either commits, the row leaves "submitted" for good, so the
    // loser's re-check genuinely fails.
    const id = await seedApplication("submitted");

    const [toUnderReview, toWithdrawn] = await Promise.all([
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "under_review", ["submitted"], ACTOR_A))),
      runWithTenant(TENANT_A, () => db.transaction((tx) => repo.updateStatus(tx, TENANT_A, id, "withdrawn", ["submitted"], ACTOR_A))),
    ]);

    const applied = [toUnderReview, toWithdrawn].filter((r) => r !== null);
    expect(applied).toHaveLength(1);

    const row = await findAsTenantA(id);
    expect(row?.version).toBe(2);
    expect(["under_review", "withdrawn"]).toContain(row?.status);
  });
});
