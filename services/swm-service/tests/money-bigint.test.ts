/**
 * GAP2-PLATFORM-MONEY-INT-02 regression: swm_bulk_generators.fee_minor and
 * swm_collection_requests.fee_minor were typed `integer` (int4, max 2^31-1 =
 * 2,147,483,647 paise ≈ ₹2.14 crore). A fee at or above 2^31 paise overflowed
 * the column. 0004_money_bigint_paise.sql widens both to bigint and the Drizzle
 * models now declare them `bigint` mode.
 *
 * This inserts a value ABOVE 2^31 directly through the repo (the fee is
 * server-derived and small in normal flow, so the only way to exercise the
 * widened column is a direct repo round-trip) and asserts it reads back
 * exactly, with no overflow/truncation. On the OLD int4 column this insert
 * would raise "integer out of range" (22003); on the new bigint column it
 * round-trips. Runs inside a rolled-back transaction so it leaves no residue.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import * as generatorRepo from "../src/modules/bulk_generators/repo.js";
import * as collectionRepo from "../src/modules/collection/repo.js";
import { TENANT_A } from "./support.js";

// 2^31 (2,147,483,648) + a bit — ₹21,474,836.49, comfortably past int4's max
// and well within both bigint and JS Number.MAX_SAFE_INTEGER.
const OVER_INT4 = 2_147_483_648n + 100n;

afterAll(async () => {
  await sqlClient.end();
});

class Rollback extends Error {}

describe("GAP2-PLATFORM-MONEY-INT-02: swm fee_minor is bigint (no int4 overflow)", () => {
  it("swm_bulk_generators.fee_minor round-trips a value > 2^31 paise", async () => {
    const id = randomUUID();
    const actorId = randomUUID();
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_A}'`));
        await generatorRepo.insert(tx, {
          id, tenantId: TENANT_A, registrationNumber: `SWM-BG-${id.slice(0, 8)}`,
          generatorName: "Overflow Co", generatorType: "hospital", category: "mixed",
          status: "registered", feeMinor: OVER_INT4,
          createdBy: actorId, updatedBy: actorId,
        });
        const rows = (await tx.execute(
          sql.raw(`SELECT fee_minor FROM civitas_swm.swm_bulk_generators WHERE id = '${id}'`),
        )) as unknown as Array<{ fee_minor: string | number | bigint }>;
        expect(BigInt(rows[0]!.fee_minor)).toBe(OVER_INT4);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  });

  it("swm_collection_requests.fee_minor round-trips a value > 2^31 paise", async () => {
    const id = randomUUID();
    const actorId = randomUUID();
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_A}'`));
        await collectionRepo.insertRequest(tx, {
          id, tenantId: TENANT_A, requestNumber: `SWM-CR-${id.slice(0, 8)}`,
          requestedBy: actorId, wasteType: "hazardous",
          status: "requested", feeMinor: OVER_INT4, feePaid: false,
          createdBy: actorId, updatedBy: actorId,
        });
        const rows = (await tx.execute(
          sql.raw(`SELECT fee_minor FROM civitas_swm.swm_collection_requests WHERE id = '${id}'`),
        )) as unknown as Array<{ fee_minor: string | number | bigint }>;
        expect(BigInt(rows[0]!.fee_minor)).toBe(OVER_INT4);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  });
});
