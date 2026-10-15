/**
 * GAP-GRANTS-DETAIL-03: the disburse consumer strips the "grant_bank_accounts:" prefix from beneficiaryBankRef
 * before resolving the payee, so a prefixed ref resolves the beneficiary and an unresolvable ref is NonRetryable.
 * Real PFMS mode is forced (isConfigured -> true) because that is the only branch that resolves the beneficiary.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { NonRetryableError } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";

vi.mock("@civitasone/gov-adapters/pfms", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, isConfigured: () => true };
});

import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { grantSchemes } from "../src/modules/scheme/schema.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantInstallments, grantDisbursements } from "../src/modules/disbursement/schema.js";
import { grantBeneficiaries, grantBankAccounts } from "../src/modules/beneficiary/schema.js";
import { registerDisbursementConsumers } from "../src/modules/disbursement/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "dd000000-aaaa-4000-8000-000000000a35";
const ACTOR = "dd000000-aaaa-4000-8000-000000000a01";
const SCHEME = "dd000000-bbbb-4000-8000-000000000a01";
const APP = "dd000000-cccc-4000-8000-000000000a01";
const BEN = "dd000000-dddd-4000-8000-000000000a01";
const INST = "dd000000-eeee-4000-8000-000000000a01";
const BANK = "dd000000-ffff-4000-8000-000000000a01";

const handlers = new Map<string, Handler>();
const fakeQueue = {
  subscribe: (topic: string, h: Handler) => { handlers.set(topic, withTenantConsumer(h as never) as Handler); },
} as unknown as Queue;
registerDisbursementConsumers(fakeQueue);

async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(grantDisbursements).where(eq(grantDisbursements.tenantId, TENANT));
    await tx.delete(grantInstallments).where(eq(grantInstallments.tenantId, TENANT));
    await tx.delete(grantApplications).where(eq(grantApplications.tenantId, TENANT));
    await tx.delete(grantBankAccounts).where(eq(grantBankAccounts.tenantId, TENANT));
    await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, TENANT));
    await tx.delete(grantSchemes).where(eq(grantSchemes.tenantId, TENANT));
  }));
}

beforeEach(async () => {
  await wipe();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(grantSchemes).values({
      id: SCHEME, tenantId: TENANT, code: "SCH-BR", name: "Bank ref scheme",
      budgetMinor: 100_000n, disbursedMinor: 0n, minAmountMinor: 0n, maxAmountMinor: 100_000n,
      currency: "INR", status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(grantBeneficiaries).values({ id: BEN, tenantId: TENANT, name: "Ref Ben", type: "individual", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(grantBankAccounts).values({
      id: BANK, tenantId: TENANT, beneficiaryId: BEN, accountNoMasked: "XXXX1234", bankIfsc: "SBIN0000001",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(grantApplications).values({
      id: APP, tenantId: TENANT, grantNo: "G-BR", schemeId: SCHEME, beneficiaryId: BEN,
      purpose: "test", amountRequestedMinor: 5_000n, amountApprovedMinor: 5_000n,
      currency: "INR", status: "approved", approvedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(grantInstallments).values({
      id: INST, tenantId: TENANT, applicationId: APP, installmentNo: 1,
      amountMinor: 3_000n, currency: "INR", status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
});
afterAll(async () => { await wipe(); await sqlClient.end(); });

const msg = (beneficiaryBankRef: string) => ({
  messageId: randomUUID(), type: COMMANDS.disbursementInitiate, tenantId: TENANT, actorId: ACTOR,
  correlationId: "corr-bankref", schemaVersion: "1.0",
  payload: { id: randomUUID(), tenantId: TENANT, installmentId: INST, mode: "PFMS", beneficiaryBankRef },
});
const run = (ref: string) => handlers.get(COMMANDS.disbursementInitiate)!(msg(ref) as never);

describe("disburse consumer — beneficiaryBankRef prefix", () => {
  it("a prefixed ref resolves the beneficiary (fails later, at the masked-account gate, not at lookup)", async () => {
    const err = await run(`grant_bank_accounts:${BANK}`).catch((e) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(String(err.message)).toContain("PFMS_FULL_ACCOUNT_UNAVAILABLE");
  });
  it("a bare uuid ref resolves the same way", async () => {
    const err = await run(BANK).catch((e) => e);
    expect(String(err.message)).toContain("PFMS_FULL_ACCOUNT_UNAVAILABLE");
  });
  it("an unresolvable prefixed ref is NonRetryable PFMS_BENEFICIARY_UNRESOLVED", async () => {
    const err = await run(`grant_bank_accounts:${randomUUID()}`).catch((e) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(String(err.message)).toContain("PFMS_BENEFICIARY_UNRESOLVED");
  });
});
