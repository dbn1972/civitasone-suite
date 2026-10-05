/**
 * Scan-link contract fixtures (packages/scan-link/src/fixtures.ts) vs the finance consumer -- REAL DB.
 * Every finance_payment / finance_voucher / finance_bill fixture request and unlink request is fed to the consumer
 * handlers; the emitted `finance.scan-link.result` / `.unlink.result` events must parse with the scan-link zod
 * schemas and match the fixture results EXACTLY (same shared reason codes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  linkRequestFixture, linkResultFixture, unlinkRequestFixture, unlinkResultFixture, FIXTURE_IDS,
  linkResultSchema, unlinkResultSchema, type LinkTarget,
} from "@civitasone/scan-link";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBills, financePayments } from "../src/modules/payments/schema.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeScannedDocuments as sd } from "../src/modules/scan-link/schema.js";
import { handleLinkRequest, handleUnlinkRequest } from "../src/modules/scan-link/consumer.js";
import { outboxMessages } from "../src/shared/outbox.js";

const TENANT = randomUUID();
// Row ids are global PKs, so each run uses a fresh target id (passed as a fixture override), not the fixed fixture one.
const TARGET = randomUUID();
const ACTOR = FIXTURE_IDS.requestedBy;
const FINANCE: LinkTarget[] = ["finance_payment", "finance_voucher", "finance_bill"];
// Fixture finance hint: reference "V-100", amount 150000 paise.
const common = { createdBy: ACTOR, updatedBy: ACTOR };

const msg = (payload: unknown) => ({ messageId: randomUUID(), tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), payload });
const events = (topic: string, linkId: string) =>
  scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.topic, topic)))
    .then((rows) => rows.filter((r) => (r.payload as { linkId?: string }).linkId === linkId));

/** Exact equality with the fixture, including the shared reason CODE. `detail` is optional extra context: when present
 * it must be PII-free scalars; it is compared separately by the caller. */
function expectMatchesFixture(actual: Record<string, unknown>, fixture: Record<string, unknown>) {
  const { detail: _d, ...a } = actual;
  expect(a).toEqual(fixture);
}

beforeAll(async () => {
  const head = randomUUID();
  await scoped(TENANT, async (tx) => {
    await tx.insert(financeHeads).values({ id: head, tenantId: TENANT, code: "5100", name: "Fixture head", level: 1, classification: "expenditure", ...common });
    // The fixture targetId is the SAME uuid for all three kinds (different tables), each matching "V-100" / 150000.
    await tx.insert(financeBills).values({ id: TARGET, tenantId: TENANT, billNo: "V-100", vendorId: randomUUID(), headId: head, grossMinor: 150_000n, netMinor: 150_000n, ...common });
    await tx.insert(financePayments).values({ id: TARGET, tenantId: TENANT, billId: TARGET, mode: "NEFT", amountMinor: 150_000n, eftRef: "V-100", ...common });
    await tx.insert(financeJournals).values({
      id: TARGET, tenantId: TENANT, voucherNo: "V-100", type: "journal", postingDate: "2026-10-01", status: "posted",
      lines: [{ accountCode: "5100", debitMinor: "150000", creditMinor: "0" }, { accountCode: "2100", debitMinor: "0", creditMinor: "150000" }], ...common,
    });
  });
});
afterAll(async () => { await sqlClient.end(); });

describe.each(FINANCE)("fixtures: %s", (target) => {
  it("accepts the fixture request and emits a `linked` result shaped like the fixture", async () => {
    const linkId = randomUUID();
    const req = linkRequestFixture(target, { linkId, targetId: TARGET });
    const r = await handleLinkRequest(msg(req));
    expect(r).not.toBeNull();
    const [ev] = await events("finance.scan-link.result", linkId);
    const parsed = linkResultSchema.parse(ev!.payload);
    expectMatchesFixture(parsed, linkResultFixture(target, "linked", { linkId, targetId: TARGET }));
    expect(await scoped(TENANT, (tx) => tx.select().from(sd).where(eq(sd.linkId, linkId)))).toHaveLength(1);
  });

  it("amount-mismatch fixture request -> flagged_mismatch result, nothing attached", async () => {
    const linkId = randomUUID();
    const req = linkRequestFixture(target, { linkId, targetId: TARGET, financeHint: { reference: "V-100", amountMinor: "150001" } });
    await handleLinkRequest(msg(req));
    const [ev] = await events("finance.scan-link.result", linkId);
    const parsed = linkResultSchema.parse(ev!.payload);
    expectMatchesFixture(parsed, linkResultFixture(target, "flagged_mismatch", { linkId, targetId: TARGET }));
    expect(parsed.detail).toEqual({ expectedMinor: "150000", scannedMinor: "150001" });
    expect(await scoped(TENANT, (tx) => tx.select().from(sd).where(eq(sd.linkId, linkId)))).toHaveLength(0);
  });

  it("unknown target -> rejected result shaped like the fixture", async () => {
    const linkId = randomUUID();
    const targetId = randomUUID();
    await handleLinkRequest(msg(linkRequestFixture(target, { linkId, targetId })));
    const [ev] = await events("finance.scan-link.result", linkId);
    expectMatchesFixture(linkResultSchema.parse(ev!.payload), linkResultFixture(target, "rejected", { linkId, targetId }));
  });

  it("accepts the fixture unlink request after a link and emits an `unlinked` result; an unknown link is `rejected`", async () => {
    const linkId = randomUUID();
    await handleLinkRequest(msg(linkRequestFixture(target, { linkId, targetId: TARGET })));
    const r = await handleUnlinkRequest(msg(unlinkRequestFixture(target, { linkId, targetId: TARGET })));
    expect(r).not.toBeNull();
    const [ev] = await events("finance.scan-link.unlink.result", linkId);
    expectMatchesFixture(unlinkResultSchema.parse(ev!.payload), unlinkResultFixture("unlinked", { linkId }));

    const ghost = randomUUID();
    await handleUnlinkRequest(msg(unlinkRequestFixture(target, { linkId: ghost, targetId: TARGET })));
    const [gev] = await events("finance.scan-link.unlink.result", ghost);
    expectMatchesFixture(unlinkResultSchema.parse(gev!.payload), unlinkResultFixture("rejected", { linkId: ghost }));
  });
});
