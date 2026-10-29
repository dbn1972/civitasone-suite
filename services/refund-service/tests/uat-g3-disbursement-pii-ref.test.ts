/**
 * UAT g3 regression tests (refund-service):
 *  #5 POST /disbursements/:id/complete must persist the supplied disbursement_ref.
 *  #6 the bank account number must never be stored/published/returned in cleartext.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient, type ScopedTx } from "../src/shared/db.js";
import * as requestsRepo from "../src/modules/requests/repo.js";
import * as reconciliationRepo from "../src/modules/reconciliation/repo.js";
import { encryptPii, decryptPii, isEncrypted, maskAccountNumber, resetPiiKeyCache } from "../src/shared/pii-crypto.js";
import { hdr, TENANT_A } from "./support.js";

const published: Array<{ topic: string; payload: Record<string, unknown> }> = [];
vi.mock("../src/shared/publish.js", async (orig) => {
  const real = await orig<typeof import("../src/shared/publish.js")>();
  return {
    ...real,
    publishCommand: vi.fn(async (_ctx: unknown, topic: string, id: string, payload: Record<string, unknown>) => {
      published.push({ topic, payload });
      return { id, status: "accepted", correlationId: "c" };
    }),
  };
});

const ACCOUNT = "123456789012";
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("pii-crypto (refund)", () => {
  it("round-trips, produces an enc:v2 envelope and never contains the plaintext", () => {
    const sealed = encryptPii(ACCOUNT);
    expect(isEncrypted(sealed)).toBe(true);
    expect(sealed).not.toContain(ACCOUNT);
    expect(decryptPii(sealed)).toBe(ACCOUNT);
  });
  it("masks to the last four digits for ciphertext and legacy plaintext", () => {
    expect(maskAccountNumber(encryptPii(ACCOUNT))).toBe("********9012");
    expect(maskAccountNumber(ACCOUNT)).toBe("********9012");
  });
  it("masks fully (no throw, no leak) when the ciphertext is tampered", () => {
    const sealed = encryptPii(ACCOUNT);
    expect(maskAccountNumber(sealed.slice(0, -4) + "AAAA")).toBe("****");
  });
  it("throws a typed error with no key configured (fail closed)", () => {
    const saved = process.env.PII_ENC_KEY;
    delete process.env.PII_ENC_KEY;
    resetPiiKeyCache();
    try {
      expect(() => encryptPii(ACCOUNT)).toThrow(/PII_ENC_KEY/);
    } finally {
      process.env.PII_ENC_KEY = saved;
      resetPiiKeyCache();
    }
  });
});

describe("#6 initiate disbursement never publishes or stores the account number in cleartext", () => {
  it("encrypts accountNumber in the command payload", async () => {
    const { initiateDisbursement } = await import("../src/modules/reconciliation/commands.js");
    published.length = 0;
    await initiateDisbursement(
      { tenantId: TENANT_A, actorId: randomUUID(), correlationId: "c" } as never,
      randomUUID(),
      { accountNumber: ACCOUNT, ifscCode: "SBIN0001234", accountHolderName: "T" },
      "100",
    );
    const sent = published[0]!.payload.bankAccountDetails as { accountNumber: string };
    expect(isEncrypted(sent.accountNumber)).toBe(true);
    expect(JSON.stringify(published[0]!.payload)).not.toContain(ACCOUNT);
  });

  async function seedApprovedRequest(): Promise<string> {
    const id = randomUUID();
    const actor = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_A}'`));
      await requestsRepo.insertRequest(tx, {
        id, tenantId: TENANT_A, requestNumber: `TEST/G3/${id.slice(0, 8)}`, status: "approved",
        applicantName: "UATTEST g3", applicantPhone: "9000000000",
        originalServiceType: "test", originalTransactionRef: "G3-TEST",
        originalAmountMinor: 100n, refundAmountMinor: 100n, refundReason: "other",
        description: null, documents: [], currency: "INR", createdBy: actor, updatedBy: actor,
      });
    });
    return id;
  }
  async function deleteRequest(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_A}'`));
      await tx.execute(sql`DELETE FROM refund.refund_requests WHERE id = ${id}`);
    });
  }
  const initiate = (requestId: string, accountNumber: string) => app.inject({
    method: "POST", url: "/v1/refund/disbursements", headers: hdr(),
    payload: { requestId, bankAccountDetails: { accountNumber, ifscCode: "SBIN0001234", accountHolderName: "T" }, disbursedAmountMinor: "100" },
  });

  it("route answers 503 ENCRYPTION_UNAVAILABLE (and publishes nothing) when no key is configured, for a real approved request", async () => {
    const requestId = await seedApprovedRequest();
    const saved = process.env.PII_ENC_KEY;
    delete process.env.PII_ENC_KEY;
    resetPiiKeyCache();
    published.length = 0;
    try {
      const res = await initiate(requestId, ACCOUNT);
      expect(res.statusCode).toBe(503);
      expect(JSON.stringify(res.json())).toContain("ENCRYPTION_UNAVAILABLE");
      expect(published).toHaveLength(0);
    } finally {
      process.env.PII_ENC_KEY = saved;
      resetPiiKeyCache();
      await deleteRequest(requestId);
    }
  });

  it("with a key, the same approved request is accepted (202) and the published account number is sealed", async () => {
    const requestId = await seedApprovedRequest();
    published.length = 0;
    try {
      const res = await initiate(requestId, ACCOUNT);
      expect(res.statusCode).toBe(202);
      expect(JSON.stringify(published[0]!.payload)).not.toContain(ACCOUNT);
    } finally {
      await deleteRequest(requestId);
    }
  });

  it("rejects a client-supplied enc: envelope as accountNumber with 400 and publishes nothing", async () => {
    const requestId = await seedApprovedRequest();
    published.length = 0;
    try {
      for (const v of ["enc:v2:k1:AAAA", " ENC:v1:AAAA"]) {
        const res = await initiate(requestId, v);
        expect(res.statusCode).toBe(400);
      }
      expect(published).toHaveLength(0);
    } finally {
      await deleteRequest(requestId);
    }
  });

  it("GET /disbursements/:id returns the masked account number, even for a legacy plaintext row", async () => {
    const id = randomUUID();
    const actor = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_A}'`));
      await tx.execute(sql`
        INSERT INTO refund.refund_disbursements
          (id, tenant_id, request_id, bank_account_details, disbursed_amount_minor, status, currency, created_by, updated_by)
        VALUES (${id}, ${TENANT_A}, ${randomUUID()}, ${JSON.stringify({ accountNumber: ACCOUNT, ifscCode: "X", accountHolderName: "Y" })}::jsonb, 100, 'initiated', 'INR', ${actor}, ${actor})`);
    });
    try {
      const res = await app.inject({ method: "GET", url: `/v1/refund/disbursements/${id}`, headers: hdr() });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(ACCOUNT);
      expect((res.json() as { data: { bankAccountDetails: { accountNumber: string } } }).data.bankAccountDetails.accountNumber).toBe("********9012");
    } finally {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_A}'`));
        await tx.execute(sql`DELETE FROM refund.refund_disbursements WHERE id = ${id}`);
      });
    }
  });
});

class Rollback extends Error {}
async function inTenantTx(fn: (tx: ScopedTx) => Promise<void>): Promise<void> {
  await expect(
    db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_A}'`));
      await fn(tx);
      throw new Rollback();
    }),
  ).rejects.toThrow(Rollback);
}

describe("#5 complete persists disbursement_ref", () => {
  it("stores the supplied reference together with status=completed", async () => {
    await inTenantTx(async (tx) => {
      const id = randomUUID();
      const actor = randomUUID();
      await tx.execute(sql`
        INSERT INTO refund.refund_disbursements
          (id, tenant_id, request_id, bank_account_details, disbursed_amount_minor, status, currency, created_by, updated_by)
        VALUES (${id}, ${TENANT_A}, ${randomUUID()}, '{"accountNumber":"1","ifscCode":"X","accountHolderName":"Y"}'::jsonb, 100, 'initiated', 'INR', ${actor}, ${actor})`);
      const ok = await reconciliationRepo.updateStatus(tx, id, TENANT_A, "completed", actor, ["initiated", "processing"], { disbursementRef: "UTR-TEST-0001" });
      expect(ok).toBe(true);
      const row = await reconciliationRepo.findByIdTx(tx, id, TENANT_A);
      expect(row?.disbursementRef).toBe("UTR-TEST-0001");
      expect(row?.status).toBe("completed");
      expect(row?.disbursedAt).toBeTruthy();
    });
  });

  it("leaves disbursement_ref untouched when no reference is passed (fail path)", async () => {
    await inTenantTx(async (tx) => {
      const id = randomUUID();
      const actor = randomUUID();
      await tx.execute(sql`
        INSERT INTO refund.refund_disbursements
          (id, tenant_id, request_id, bank_account_details, disbursed_amount_minor, status, disbursement_ref, currency, created_by, updated_by)
        VALUES (${id}, ${TENANT_A}, ${randomUUID()}, '{"accountNumber":"1","ifscCode":"X","accountHolderName":"Y"}'::jsonb, 100, 'initiated', 'KEEP', 'INR', ${actor}, ${actor})`);
      await reconciliationRepo.updateStatus(tx, id, TENANT_A, "processing", actor, ["initiated"]);
      const row = await reconciliationRepo.findByIdTx(tx, id, TENANT_A);
      expect(row?.disbursementRef).toBe("KEEP");
    });
  });
});
