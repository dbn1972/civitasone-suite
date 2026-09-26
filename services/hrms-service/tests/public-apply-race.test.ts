/**
 * Public apply response-integrity — deterministic regression test against a
 * REAL Postgres (not mocked; see screening-decision-race.test.ts in this same
 * directory for the same real-DB concurrency-proof pattern).
 *
 * BACKGROUND: POST /v1/careers/apply (the public, unauthenticated candidate
 * apply endpoint) used to generate an id and fire COMMANDS.applicationCreate
 * at the queue (commands.ts's old createPublicApplication), returning 202 +
 * that id immediately — BEFORE consumer.ts's applicationCreate subscriber
 * (the thing that actually runs the INSERT) had even run. The data layer was
 * always safe: hrms_applications_dedup_uq (migration
 * 0074_application_eligibility.sql) only ever lets ONE row per
 * (tenant, job opening, email) land. But the HTTP response layer was not —
 * proven live: 5 genuinely concurrent (Promise.all) identical-email
 * applications against the same opening got back 5 different 202s with 5
 * different ids, and querying for the 4 "losing" ids afterward found no row
 * at all. The consumer's catch of the resulting 23505 just logs "duplicate
 * application suppressed" and drops the message — the caller holding that
 * id has no way to ever find out it corresponds to nothing.
 *
 * THE FIX makes the insert happen synchronously, inside the request
 * (commands.ts's submitPublicApplication), so the response always reflects
 * whichever row the DB's own unique index actually let through: the winner
 * gets 202 with the real new id, and every loser gets 409
 * DUPLICATE_APPLICATION carrying the SAME real, already-persisted
 * application's id — never a fabricated one. Like
 * screening-decision-race.test.ts, the vulnerable window was entirely
 * app-level (a queue round-trip the request didn't wait for), not something
 * needing an artificial pause to reproduce: firing 5 real requests through
 * Promise.all with no await between them reproduces the original bug
 * deterministically.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsApplications, hrmsJobOpenings } from "../src/modules/recruitment/schema.js";
import { buildApp } from "../src/app.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();

async function seedVacancy(id: string, opts: { allowMultiple?: boolean } = {}): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(hrmsJobOpenings).values({
    id, tenantId: TENANT, refNo: `REF-APPLY-RACE-${id.slice(0, 8)}`, title: "Apply Race Test Vacancy",
    departmentId: randomUUID(), vacancyType: "regular",
    isPublished: true, status: "open",
    eligibility: opts.allowMultiple ? { allowMultiple: true } : {},
    createdBy: ACTOR, updatedBy: ACTOR,
  })));
}

async function findByDedupKey(jobOpeningId: string, dedupKey: string) {
  return runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(hrmsApplications)
    .where(and(
      eq(hrmsApplications.tenantId, TENANT),
      eq(hrmsApplications.jobOpeningId, jobOpeningId),
      eq(hrmsApplications.dedupKey, dedupKey),
    ))));
}

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsApplications).where(eq(hrmsApplications.tenantId, TENANT));
    await tx.delete(hrmsJobOpenings).where(eq(hrmsJobOpenings.tenantId, TENANT));
  }));
  await sqlClient.end();
});

describe("POST /v1/careers/apply — response-integrity under concurrency (real Postgres)", () => {
  it("TRUE CONCURRENCY: 5 identical-email applications — every response carries a real id, all 5 agree on ONE persisted application", async () => {
    const vacancyId = randomUUID();
    await seedVacancy(vacancyId);
    const app = await buildApp();
    const email = `race-candidate-${randomUUID()}@example.test`;

    const payload = {
      tenantId: TENANT, jobOpeningId: vacancyId,
      applicantName: "Race Candidate", email,
      // Deliberately no `mobile`: services/hrms-service's mobile-field PII
      // encryption overflowing its varchar(20) column is a separate,
      // already-tracked bug — omitted here so this test proves THIS fix
      // independently of that one.
    };

    // Fired via Promise.all with no await between them: every request's own
    // pre-check read happens before any of the 5 inserts land — exactly the
    // proven bug's precondition (genuine concurrency, not 5 sequential
    // requests that would only ever exercise the OLD pre-check).
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.inject({ method: "POST", url: "/v1/careers/apply", payload })),
    );

    const statuses = responses.map((r) => r.statusCode).sort((a, b) => a - b);
    expect(statuses).toEqual([202, 409, 409, 409, 409]);

    // Every response — winner and losers alike — must carry an id. This is
    // the core of the proven bug: 4 of 5 used to carry an id with NO backing
    // row, indistinguishable from a real success without querying the DB.
    const ids = responses.map((r) => {
      const body = r.json() as { id?: string; applicationId?: string; code?: string };
      const id = r.statusCode === 202 ? body.id : body.applicationId;
      expect(id, `response (status ${r.statusCode}) must carry a real application id: ${JSON.stringify(body)}`).toBeTruthy();
      if (r.statusCode === 409) expect(body.code).toBe("DUPLICATE_APPLICATION");
      return id as string;
    });

    // All 5 must agree on the SAME single application -- not 5 independent
    // ids, only one of which happens to be real.
    expect(new Set(ids).size).toBe(1);
    const winningId = ids[0]!;

    // And that id must have a real, queryable backing row -- exactly one.
    const rows = await findByDedupKey(vacancyId, email.toLowerCase());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(winningId);
    expect(rows[0]!.email).toBe(email);

    await app.close();
  });

  it("control: allowMultiple vacancy — 5 concurrent identical-email applications all succeed as independent applications", async () => {
    const vacancyId = randomUUID();
    await seedVacancy(vacancyId, { allowMultiple: true });
    const app = await buildApp();
    const email = `race-candidate-multi-${randomUUID()}@example.test`;
    const payload = { tenantId: TENANT, jobOpeningId: vacancyId, applicantName: "Multi Candidate", email };

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.inject({ method: "POST", url: "/v1/careers/apply", payload })),
    );

    expect(responses.map((r) => r.statusCode)).toEqual([202, 202, 202, 202, 202]);
    const ids = responses.map((r) => (r.json() as { id: string }).id);
    expect(new Set(ids).size).toBe(5); // 5 genuinely independent applications, never merged/deduped

    await app.close();
  });
});
