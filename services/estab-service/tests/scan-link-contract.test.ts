/**
 * Contract test: the estab consumers accept the CANONICAL @civitasone/scan-link fixtures (real Postgres) and the
 * result / unlink-result events they emit parse with the scan-link zod schemas and deep-equal the fixture results.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import {
  FIXTURE_IDS, scanLinkFixtures, linkResultSchema, unlinkResultSchema, linkRequestFixture, linkResultFixture,
} from "@civitasone/scan-link";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles } from "../src/modules/files/schema.js";
import { fileScannedDocuments } from "../src/modules/scan-link/schema.js";
import { registerScanLinkConsumers, SCAN_LINK_TOPICS } from "../src/modules/scan-link/consumer.js";

const TD = "5ca00003-0000-4000-8000-00000000000d";
const TE = "5ca00003-0000-4000-8000-00000000000e";
type Handler = (msg: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, Handler>();
const messageIds: string[] = [];
registerScanLinkConsumers({ subscribe: (t: string, h: Handler) => void handlers.set(t, h) } as unknown as Queue);

async function deliver(topic: string, payload: unknown, tenant = TD): Promise<void> {
  const messageId = randomUUID();
  messageIds.push(messageId);
  await handlers.get(topic)!({ messageId, type: topic, tenantId: tenant, actorId: FIXTURE_IDS.requestedBy, correlationId: "corr-contract", schemaVersion: "1.0", payload });
}
async function emitted(topic: string, tenant = TD): Promise<unknown[]> {
  const rows = await sqlClient`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant} AND topic = ${topic} ORDER BY created_at`;
  return rows.map((r) => r.payload);
}
const clean = () => sqlClient`DELETE FROM _outbox.messages WHERE tenant_id IN (${TD}, ${TE})`;
async function wipe(): Promise<void> {
  for (const t of [TD, TE]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(fileScannedDocuments).where(eq(fileScannedDocuments.tenantId, t));
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, t));
    }));
  }
  await clean();
}
async function seedTargetFile(status = "active"): Promise<void> {
  await runWithTenant(TD, () => db.transaction((tx) => tx.insert(estabFiles).values({
    id: FIXTURE_IDS.targetId, tenantId: TD, fileNo: "CONTRACT/1", subject: "contract fixture file", dept: "EST",
    currentWith: FIXTURE_IDS.requestedBy, status, classification: "public", createdBy: FIXTURE_IDS.requestedBy, updatedBy: FIXTURE_IDS.requestedBy,
  })));
}

const fx = () => scanLinkFixtures().eoffice_file;

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  if (messageIds.length) await sqlClient`DELETE FROM _inbox.processed WHERE message_id IN ${sqlClient(messageIds)}`;
  await sqlClient.end();
});

describe("estab consumers vs canonical scan-link fixtures (eoffice_file)", () => {
  it("fixture request on an open file => emitted result parses and deep-equals the `linked` fixture", async () => {
    await seedTargetFile();
    await deliver(SCAN_LINK_TOPICS.request, fx().request);
    const out = await emitted(SCAN_LINK_TOPICS.result);
    expect(out).toHaveLength(1);
    expect(linkResultSchema.parse(out[0])).toEqual(fx().results.linked);
    const rows = await runWithTenant(TD, () => db.transaction((tx) => tx.select().from(fileScannedDocuments)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ linkId: FIXTURE_IDS.linkId, documentId: FIXTURE_IDS.documentId, state: "linked" });
  });

  it("fixture request with no such eFile => deep-equals the `rejected` fixture (TARGET_NOT_FOUND)", async () => {
    await deliver(SCAN_LINK_TOPICS.request, fx().request);
    const out = await emitted(SCAN_LINK_TOPICS.result);
    expect(linkResultSchema.parse(out[0])).toEqual(fx().results.rejected);
  });

  it("fixture request redelivered with the same linkId re-emits an identical `linked` result", async () => {
    await seedTargetFile();
    await deliver(SCAN_LINK_TOPICS.request, fx().request);
    await deliver(SCAN_LINK_TOPICS.request, fx().request);
    const out = (await emitted(SCAN_LINK_TOPICS.result)).map((o) => linkResultSchema.parse(o));
    expect(out).toEqual([fx().results.linked, fx().results.linked]);
  });

  it("fixture unlink request => deep-equals the `unlinked` fixture; unknown link => the `rejected` fixture", async () => {
    await seedTargetFile();
    await deliver(SCAN_LINK_TOPICS.request, fx().request);
    await deliver(SCAN_LINK_TOPICS.unlinkRequest, fx().unlinkRequest);
    const done = (await emitted(SCAN_LINK_TOPICS.unlinkResult)).map((o) => unlinkResultSchema.parse(o));
    expect(done).toEqual([fx().unlinkResults.unlinked]);

    await clean();
    await deliver(SCAN_LINK_TOPICS.unlinkRequest, fx().unlinkRequest, TE); // other tenant: no such link
    const rej = (await emitted(SCAN_LINK_TOPICS.unlinkResult, TE)).map((o) => unlinkResultSchema.parse(o));
    expect(rej).toEqual([fx().unlinkResults.rejected]);
  });

  it("a request with overrides still round-trips through the schema (closed file => rejected FILE_CLOSED)", async () => {
    await seedTargetFile("closed");
    await deliver(SCAN_LINK_TOPICS.request, linkRequestFixture("eoffice_file"));
    const out = linkResultSchema.parse((await emitted(SCAN_LINK_TOPICS.result))[0]);
    expect(out).toEqual(linkResultFixture("eoffice_file", "rejected", { reason: "FILE_CLOSED" }));
  });

  it("a fixture addressed to another target kind is answered with a schema-valid rejection (TARGET_KIND_MISMATCH)", async () => {
    for (const target of ["hr_employee", "finance_payment", "finance_voucher", "finance_bill"] as const) {
      await clean();
      await deliver(SCAN_LINK_TOPICS.request, scanLinkFixtures()[target].request);
      const out = linkResultSchema.parse((await emitted(SCAN_LINK_TOPICS.result))[0]);
      expect(out).toEqual(linkResultFixture(target, "rejected", { reason: "TARGET_KIND_MISMATCH" }));
    }
  });
});
