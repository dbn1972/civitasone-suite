/**
 * FQ9-C UAT regressions (legal-service), real Postgres + RLS (legal_svc role).
 *
 *  #2  legal.settlement.create — the consumer wrote status 'settled', which the UAT
 *      legal_settlements_status_check rejects → every message dead-lettered.
 *  #3  legal.document.update with name+body — re-inserted the CURRENT version into
 *      document_versions → uq_document_versions_doc_ver → dead-letter, body unchanged.
 *  #4  GET /v1/legal/notices, /notices/:id, /cases/:id/reminders — bare db.select()
 *      with no tenant GUC → FORCE RLS hid the tenant's own rows.
 *  #8  POST /v1/legal/rti/applications/:id/appeals — a second first-tier appeal was
 *      202'd then dead-lettered APPEAL_EXISTS; now rejected synchronously with 409.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, asc } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { legalSettlements, legalLokAdalat } from "../src/modules/settlements/schema.js";
import { matterDocuments, documentVersions } from "../src/modules/documents/schema.js";
import { legalNotices } from "../src/modules/notices/schema.js";
import { legalReminders } from "../src/modules/reminders/schema.js";
import { rtiApplications, rtiAppeals } from "../src/modules/rti/schema.js";
import { registerSettlementConsumers } from "../src/modules/settlements/consumer.js";
import { registerDocumentConsumers } from "../src/modules/documents/consumer.js";
import { registerNoticeConsumers } from "../src/modules/notices/consumer.js";
import { registerRtiConsumers } from "../src/modules/rti/consumer.js";
import * as noticeRepo from "../src/modules/notices/repo.js";
import { COMMANDS } from "../src/topics.js";
import { drainOrFail } from "../../../vitest.drain";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const CASE_ID = randomUUID();

/** The settlement lifecycle the UAT CHECK enforces (and migration 0037 converges on). */
const SETTLEMENT_LIFECYCLE = ["draft", "proposed", "accepted", "rejected", "executed"];

const token = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-fq9c" }, SECRET, 3600);
const H = (roles: string[] = ["legal_officer"]) => ({
  authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT, "content-type": "application/json",
});

function wireTenantAwareQueue(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

function envelope(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
    correlationId: `fq9c-${type}`, schemaVersion: "1.0", payload: { tenantId: TENANT, ...payload },
  };
}

const inTenant = <T>(fn: (tx: any) => Promise<T>): Promise<T> => runWithTenant(TENANT, () => db.transaction(fn));

async function wipe(): Promise<void> {
  await inTenant(async (tx) => {
    await tx.delete(rtiAppeals).where(eq(rtiAppeals.tenantId, TENANT));
    await tx.delete(rtiApplications).where(eq(rtiApplications.tenantId, TENANT));
    await tx.delete(legalReminders).where(eq(legalReminders.tenantId, TENANT));
    await tx.delete(legalNotices).where(eq(legalNotices.tenantId, TENANT));
    await tx.delete(documentVersions).where(eq(documentVersions.tenantId, TENANT));
    await tx.delete(matterDocuments).where(eq(matterDocuments.tenantId, TENANT));
    await tx.delete(legalLokAdalat).where(eq(legalLokAdalat.tenantId, TENANT));
    await tx.delete(legalSettlements).where(eq(legalSettlements.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  await wipe();
  app = await buildApp();
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("FQ9 #2 — settlement create lands a row the status CHECK accepts", () => {
  it("legal_settlements_status_check admits the lifecycle statuses (migration 0037)", async () => {
    const rows = await sqlClient<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'legal_settlements_status_check'`;
    expect(rows).toHaveLength(1);
    for (const s of SETTLEMENT_LIFECYCLE) expect(rows[0]!.def).toContain(`'${s}'`);
  });

  it("settlementCreate inserts the settlement (lifecycle status) + its Lok Adalat record", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerSettlementConsumers(q);
    await q.start();
    const id = randomUUID();
    await q.publish(COMMANDS.settlementCreate, envelope(COMMANDS.settlementCreate, {
      id, caseId: CASE_ID, settlementNo: `FQ9C-S-${id.slice(0, 8)}`, amountMinor: 250000, currency: "INR",
      lokAdalat: { lokAdalatDate: "2026-10-01", venue: "District Legal Services Authority" },
    }));
    await drainOrFail(q);
    await q.stop();

    const [row] = await inTenant((tx) => tx.select().from(legalSettlements).where(eq(legalSettlements.id, id)));
    expect(row).toBeDefined();
    expect(SETTLEMENT_LIFECYCLE).toContain(row!.status);
    expect(row!.settledAt).not.toBeNull();
    const la = await inTenant((tx) => tx.select().from(legalLokAdalat).where(eq(legalLokAdalat.settlementId, id)));
    expect(la).toHaveLength(1);
  });
});

describe("FQ9 #3 — document PATCH with name+body updates the row and appends a version", () => {
  it("create(body v1) then update(name+body v2) → row has v2, versions [1, 2]", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerDocumentConsumers(q);
    await q.start();
    const docId = randomUUID();
    await q.publish(COMMANDS.documentCreate, envelope(COMMANDS.documentCreate, {
      id: docId, matterId: CASE_ID, name: "FQ9C doc", type: "file", body: "FQ9 body v1",
    }));
    await drainOrFail(q);
    await q.publish(COMMANDS.documentUpdate, envelope(COMMANDS.documentUpdate, {
      documentId: docId, name: "FQ9C doc renamed", body: "FQ9 body v2",
    }));
    await drainOrFail(q);
    await q.stop();

    const [doc] = await inTenant((tx) => tx.select().from(matterDocuments).where(eq(matterDocuments.id, docId)));
    expect(doc?.name).toBe("FQ9C doc renamed");
    expect(doc?.body).toBe("FQ9 body v2");
    expect(doc?.version).toBe(2);
    const versions = await inTenant((tx) => tx.select().from(documentVersions)
      .where(eq(documentVersions.documentId, docId)).orderBy(asc(documentVersions.versionNumber)));
    expect(versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([1, 2]);
    expect(versions[1]!.body).toBe("FQ9 body v2");
  });
});

describe("FQ9 #4 — notices / reminders read paths set the RLS tenant GUC", () => {
  const NOTICE = randomUUID();
  const REMINDER = randomUUID();

  beforeAll(async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerNoticeConsumers(q);
    await q.start();
    await q.publish(COMMANDS.noticeCreate, envelope(COMMANDS.noticeCreate, {
      id: NOTICE, noticeNo: `FQ9C-N-${NOTICE.slice(0, 8)}`, subject: "Show cause", partyRef: "party-x", direction: "sent",
    }));
    await drainOrFail(q);
    await q.stop();
    await inTenant((tx) => tx.insert(legalReminders).values({
      id: REMINDER, tenantId: TENANT, caseId: CASE_ID, remindAt: new Date("2099-01-01T09:00:00.000Z"),
      message: "FQ9C reminder", sent: false, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    }));
  });

  it("repo.listByTenant / getById see the tenant's notice inside the tenant context", async () => {
    const list = await runWithTenant(TENANT, () => noticeRepo.listByTenant(TENANT, 50, 0));
    expect(list.map((n) => n.id)).toContain(NOTICE);
    const one = await runWithTenant(TENANT, () => noticeRepo.getById(TENANT, NOTICE));
    expect(one?.id).toBe(NOTICE);
  });

  it("GET /v1/legal/notices includes the notice and GET /notices/:id returns 200", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/legal/notices?limit=100", headers: H() });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).toContain(NOTICE);
    const one = await app.inject({ method: "GET", url: `/v1/legal/notices/${NOTICE}`, headers: H() });
    expect(one.statusCode).toBe(200);
  });

  it("GET /v1/legal/cases/:id/reminders returns the case's reminder", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/legal/cases/${CASE_ID}/reminders`, headers: H() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { id: string }[]; total: number };
    expect(body.data.map((r) => r.id)).toContain(REMINDER);
  });
});

describe("FQ9 #8 — duplicate first-tier RTI appeal is rejected synchronously (409)", () => {
  it("second first appeal → 409 APPEAL_EXISTS (nothing published); first appeal still 202", async () => {
    const appId = randomUUID();
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRtiConsumers(q);
    await q.start();
    await q.publish(COMMANDS.rtiApplicationCreate, envelope(COMMANDS.rtiApplicationCreate, {
      id: appId, applicationNo: `FQ9C-RTI-${appId.slice(0, 8)}`, applicantName: "A", subject: "s", requestText: "r",
    }));
    await drainOrFail(q);
    await q.publish(COMMANDS.rtiAppealFile, envelope(COMMANDS.rtiAppealFile, {
      appealId: randomUUID(), applicationId: appId, tier: "first", appellateAuthority: "FAA", grounds: "no reply",
    }));
    await drainOrFail(q);
    await q.stop();

    const dup = await app.inject({
      method: "POST", url: `/v1/legal/rti/applications/${appId}/appeals`, headers: H(["rti_pio"]),
      payload: { tier: "first", appellateAuthority: "FAA", grounds: "again" },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("APPEAL_EXISTS");

    // A second-tier appeal while the first is undecided is also rejected up front.
    const early = await app.inject({
      method: "POST", url: `/v1/legal/rti/applications/${appId}/appeals`, headers: H(["rti_pio"]),
      payload: { tier: "second", appellateAuthority: "SIC", grounds: "FAA delay" },
    });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("FIRST_APPEAL_PENDING");

    // A fresh application's first appeal is still accepted.
    const other = await app.inject({
      method: "POST", url: `/v1/legal/rti/applications/${randomUUID()}/appeals`, headers: H(["rti_pio"]),
      payload: { tier: "first", appellateAuthority: "FAA", grounds: "delay" },
    });
    expect(other.statusCode).toBe(202);
  });
});
