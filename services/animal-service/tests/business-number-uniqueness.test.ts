/**
 * Proof that complaint/registration numbers no longer collide under
 * concurrent load. Pre-fix, both consumer.ts files computed the number as
 * `Date.now() % 999999` -- a value periodic on ~999999ms (~16.7 minutes),
 * so two commands processed within the same millisecond (trivially true
 * under any real concurrent load, and certainly true of the 50 concurrent
 * requests fired below) would very likely compute the IDENTICAL number,
 * and animal_complaints.complaint_number / animal_registrations.
 * registration_number both carry a UNIQUE constraint (migrations/
 * 0001_initial.sql) that would reject the second insert outright -- a
 * visible failure for whichever citizen's request lost the race.
 *
 * Fixed via a real Postgres SEQUENCE (migrations/0002_number_sequences.sql)
 * + nextval() reserved inside the same transaction as the insert (see
 * complaints/repo.ts's nextComplaintNumber, registration/repo.ts's
 * nextRegistrationNumber) -- guaranteed unique by Postgres itself,
 * independent of wall-clock time or process concurrency.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import * as repo from "../src/modules/complaints/repo.js";
import { hdr, drainQueue, TENANT_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerComplaintConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("complaint number generation — no collisions under concurrency", () => {
  it("reserves 50 distinct sequence values when called concurrently within the same millisecond window", async () => {
    // Direct proof of the underlying primitive: hammer nextComplaintNumber
    // itself, each call in its own transaction, all fired together.
    const results = await Promise.all(
      Array.from({ length: 50 }, () => db.transaction((tx) => repo.nextComplaintNumber(tx))),
    );
    expect(new Set(results).size).toBe(50);
  });

  it("50 concurrent POST /v1/animal/complaints all succeed and persist 50 distinct complaint_numbers -- zero UNIQUE-constraint failures", async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({
          method: "POST",
          url: "/v1/animal/complaints",
          headers: hdr(randomUUID(), TENANT_A, ["animal_user"]),
          payload: { location: {}, animalType: "dog", complaintType: "stray", severity: "low" },
        }),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(202);
    await drainQueue();

    const ids = responses.map((r) => (r.json() as { id: string }).id);
    const numbers = await Promise.all(ids.map((id) => repo.findById(id, TENANT_A).then((row) => row?.complaintNumber)));
    expect(numbers.every((n) => typeof n === "string")).toBe(true);
    expect(new Set(numbers).size).toBe(50); // every one is unique -- no dropped/collided inserts
  });
});
