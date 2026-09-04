/**
 * Proof that registration/licence numbers no longer collide under
 * concurrent load. Pre-fix, both consumer.ts files computed the number as
 * `Date.now() % 999999` -- a value periodic on ~999999ms (~16.7 minutes),
 * so two commands processed within the same millisecond (trivially true
 * under any real concurrent load, and certainly true of the concurrent
 * requests fired below) would very likely compute the IDENTICAL number,
 * and vendor_registrations.registration_number / vendor_licences.
 * licence_number both carry a UNIQUE constraint (migrations/
 * 0001_initial.sql) that would reject the second insert outright -- a
 * visible failure for whichever vendor's request lost the race.
 *
 * Fixed via a real Postgres SEQUENCE (migrations/0002_number_sequences.sql)
 * + nextval() reserved inside the same transaction as the insert (see
 * registrations/repo.ts's nextRegistrationNumber, licences/repo.ts's
 * nextLicenceNumber) -- guaranteed unique by Postgres itself, independent
 * of wall-clock time or process concurrency.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRegistrationConsumers } from "../src/modules/registrations/consumer.js";
import * as regRepo from "../src/modules/registrations/repo.js";
import { hdr, drainQueue, TENANT_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerRegistrationConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("registration number generation — no collisions under concurrency", () => {
  it("reserves 50 distinct sequence values when called concurrently within the same millisecond window", async () => {
    // Direct proof of the underlying primitive: hammer nextRegistrationNumber
    // itself, each call in its own transaction, all fired together.
    const results = await Promise.all(
      Array.from({ length: 50 }, () => db.transaction((tx) => regRepo.nextRegistrationNumber(tx))),
    );
    expect(new Set(results).size).toBe(50);
  });

  it("50 concurrent POST /v1/vendor/registrations all succeed and persist 50 distinct registration_numbers — zero UNIQUE-constraint failures", async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({
          method: "POST",
          url: "/v1/vendor/registrations",
          headers: hdr(randomUUID(), TENANT_A, ["vendor_user"]),
          payload: { vendorName: "Concurrent Vendor", vendorAadhaar: "123456789000", vendorPhone: "9876500001", category: "food" },
        }),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(202);
    await drainQueue();

    const ids = responses.map((r) => (r.json() as { id: string }).id);
    const numbers = await Promise.all(ids.map((id) => regRepo.findById(id, TENANT_A).then((row) => row?.registrationNumber)));
    expect(numbers.every((n) => typeof n === "string")).toBe(true);
    expect(new Set(numbers).size).toBe(50); // every one is unique — no dropped/collided inserts
  });
});
