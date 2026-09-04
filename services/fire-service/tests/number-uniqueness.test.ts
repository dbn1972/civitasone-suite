/**
 * Proof that application/NOC numbers no longer collide under concurrent
 * load. Pre-fix, both consumer.ts files computed the number via
 * `randomInt(1, 999999)` -- a real birthday-paradox collision risk against
 * application_number / noc_number's UNIQUE constraint (migrations/
 * 0001_initial.sql) at moderate volume, surfaced as an opaque insert
 * failure for whichever citizen/officer's request lost the race.
 *
 * Fixed via real Postgres SEQUENCEs (migrations/0002_number_sequences.sql)
 * + nextval() reserved inside the same transaction as the insert (see
 * applications/repo.ts's nextApplicationNumber, nocs/repo.ts's
 * nextNocNumber) -- guaranteed unique by Postgres itself, independent of
 * process concurrency or randomness. Mirrors services/animal-service/tests/
 * business-number-uniqueness.test.ts (PR #1007).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import * as appRepo from "../src/modules/applications/repo.js";
import * as nocRepo from "../src/modules/nocs/repo.js";
import { hdr, drainQueue, OFFICER_ROLES, TENANT_A } from "./support.js";

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

const appBody = {
  buildingName: "Concurrency Test Building",
  buildingAddress: { line1: "1 Test St", city: "Pune", pin: "411001" },
  occupancyType: "commercial" as const,
};

describe("application number generation — no collisions under concurrency", () => {
  it("reserves 50 distinct sequence values when called concurrently", async () => {
    // Direct proof of the underlying primitive: hammer
    // nextApplicationNumber itself, each call in its own transaction, all
    // fired together.
    const results = await Promise.all(
      Array.from({ length: 50 }, () => db.transaction((tx) => appRepo.nextApplicationNumber(tx))),
    );
    expect(new Set(results).size).toBe(50);
  });

  it("50 concurrent POST /v1/fire/applications all succeed and persist 50 distinct application_numbers — zero UNIQUE-constraint failures", async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({
          method: "POST",
          url: "/v1/fire/applications",
          headers: hdr(randomUUID(), TENANT_A, OFFICER_ROLES),
          payload: appBody,
        }),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(202);
    await drainQueue();
    await new Promise((r) => setTimeout(r, 200));
    await drainQueue();

    const ids = responses.map((r) => (r.json() as { id: string }).id);
    const numbers = await Promise.all(ids.map((id) => appRepo.findById(TENANT_A, id).then((row) => row?.applicationNumber)));
    expect(numbers.every((n) => typeof n === "string")).toBe(true);
    expect(new Set(numbers).size).toBe(50); // every one is unique -- no dropped/collided inserts
  });
});

describe("NOC number generation — no collisions under concurrency", () => {
  it("reserves 50 distinct sequence values when called concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => db.transaction((tx) => nocRepo.nextNocNumber(tx))),
    );
    expect(new Set(results).size).toBe(50);
  });
});
