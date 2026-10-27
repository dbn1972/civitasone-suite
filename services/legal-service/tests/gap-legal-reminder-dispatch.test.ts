/**
 * GAP-LEGAL-HEARINGS-05 (owner decision #8): a 5-minute dispatcher sweep sends
 * due case reminders through notification-service. Recipient = the case's
 * assigned officer(s); the reminder's creator is cc'd. Exactly once per reminder.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { scannerSqlClient } from "../src/shared/scanner-db.js";
import { legalCases } from "../src/modules/cases/schema.js";
import { legalReminders } from "../src/modules/reminders/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { sweepDueReminders, DISPATCH_INTERVAL_MS } from "../src/modules/reminders/dispatcher.js";

const TENANT = "11111111-aaaa-4000-8000-0000000d0801";
const OTHER_TENANT = "11111111-aaaa-4000-8000-0000000d0802";
const CREATOR = "00000000-aaaa-4000-8000-0000000d0801";
const OFFICER = "00000000-aaaa-4000-8000-0000000d0802";
const CASE_ID = "22222222-bbbb-4000-8000-0000000d0801";
const CASE_NO_OFFICER = "22222222-bbbb-4000-8000-0000000d0802";
const R_DUE = "33333333-cccc-4000-8000-0000000d0801";
const R_FUTURE = "33333333-cccc-4000-8000-0000000d0802";
const R_NOOFFICER = "33333333-cccc-4000-8000-0000000d0803";
const R_OTHER = "33333333-cccc-4000-8000-0000000d0804";
const OTHER_CASE = "22222222-bbbb-4000-8000-0000000d0803";

const past = (): Date => new Date(Date.now() - 60_000);
const future = (): Date => new Date(Date.now() + 3_600_000);

async function wipe(tenant: string): Promise<void> {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenant));
    await tx.delete(legalReminders).where(eq(legalReminders.tenantId, tenant));
    await tx.delete(legalCases).where(eq(legalCases.tenantId, tenant));
  }));
}

async function seedCase(tenant: string, id: string, caseNo: string, officers: string[]): Promise<void> {
  await runWithTenant(tenant, () => db.transaction((tx) => tx.insert(legalCases).values({
    id, tenantId: tenant, caseNo, title: "State v. Example", court: "High Court",
    assignedOfficerIds: officers, createdBy: CREATOR, updatedBy: CREATOR,
  })));
}

async function seedReminder(tenant: string, id: string, caseId: string, remindAt: Date): Promise<void> {
  await runWithTenant(tenant, () => db.transaction((tx) => tx.insert(legalReminders).values({
    id, tenantId: tenant, caseId, remindAt, message: "Prepare counter-affidavit",
    sent: false, createdBy: CREATOR, updatedBy: CREATOR, version: 1,
  })));
}

const notifications = (tenant: string) => runWithTenant(tenant, () => db.transaction((tx) =>
  tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, tenant), eq(outboxMessages.topic, "notification.send")))));
const audits = (tenant: string) => runWithTenant(tenant, () => db.transaction((tx) =>
  tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, tenant), eq(outboxMessages.eventType, "legal.reminder.dispatched")))));

beforeAll(async () => { await wipe(TENANT); await wipe(OTHER_TENANT); });
beforeEach(async () => {
  await wipe(TENANT); await wipe(OTHER_TENANT);
  await seedCase(TENANT, CASE_ID, "WP/801/2026", [OFFICER]);
  await seedCase(TENANT, CASE_NO_OFFICER, "WP/802/2026", []);
  await seedCase(OTHER_TENANT, OTHER_CASE, "WP/803/2026", [OFFICER]);
});
afterAll(async () => {
  await wipe(TENANT); await wipe(OTHER_TENANT);
  await scannerSqlClient.end();
  await sqlClient.end();
});

describe("GAP-LEGAL-HEARINGS-05 dispatcher sweep (decision #8)", () => {
  it("runs every 5 minutes", () => {
    expect(DISPATCH_INTERVAL_MS).toBe(5 * 60_000);
  });

  it("sends a due reminder to the assigned officer with the creator in cc, marks it sent and audits it", async () => {
    await seedReminder(TENANT, R_DUE, CASE_ID, past());
    const res = await sweepDueReminders();
    expect(res.dispatched).toBeGreaterThanOrEqual(1);

    const sent = await notifications(TENANT);
    expect(sent).toHaveLength(2);
    const to = sent.find((m) => (m.payload as { variables?: Record<string, string> }).variables?.role === "to");
    const cc = sent.find((m) => (m.payload as { variables?: Record<string, string> }).variables?.role === "cc");
    expect((to!.payload as { recipientId: string }).recipientId).toBe(OFFICER);
    expect((cc!.payload as { recipientId: string }).recipientId).toBe(CREATOR);
    expect((to!.payload as { variables: Record<string, string> }).variables.reminderId).toBe(R_DUE);

    const row = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(legalReminders).where(eq(legalReminders.id, R_DUE))));
    expect(row[0]!.sent).toBe(true);
    expect(row[0]!.sentAt).not.toBeNull();
    expect(await audits(TENANT)).toHaveLength(1);
  });

  it("is exactly-once: a second sweep sends nothing more", async () => {
    await seedReminder(TENANT, R_DUE, CASE_ID, past());
    await sweepDueReminders();
    await sweepDueReminders();
    expect(await notifications(TENANT)).toHaveLength(2);
    expect(await audits(TENANT)).toHaveLength(1);
  });

  it("does not touch a reminder that is not yet due", async () => {
    await seedReminder(TENANT, R_FUTURE, CASE_ID, future());
    await sweepDueReminders();
    expect(await notifications(TENANT)).toHaveLength(0);
    const row = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(legalReminders).where(eq(legalReminders.id, R_FUTURE))));
    expect(row[0]!.sent).toBe(false);
  });

  it("falls back to the creator (no duplicate cc) when the case has no assigned officer", async () => {
    await seedReminder(TENANT, R_NOOFFICER, CASE_NO_OFFICER, past());
    await sweepDueReminders();
    const sent = await notifications(TENANT);
    expect(sent).toHaveLength(1);
    expect((sent[0]!.payload as { recipientId: string }).recipientId).toBe(CREATOR);
  });

  it("dispatches per tenant: each tenant's notification lands in its own outbox", async () => {
    await seedReminder(TENANT, R_DUE, CASE_ID, past());
    await seedReminder(OTHER_TENANT, R_OTHER, OTHER_CASE, past());
    await sweepDueReminders();
    expect(await notifications(TENANT)).toHaveLength(2);
    expect(await notifications(OTHER_TENANT)).toHaveLength(2);
    const other = await notifications(OTHER_TENANT);
    expect(other.every((m) => (m.payload as { variables: Record<string, string> }).variables.reminderId === R_OTHER)).toBe(true);
  });
});
