import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { legalCases } from "../src/modules/cases/schema.js";
import { legalOpinions } from "../src/modules/opinions/schema.js";
import { legalCounselBriefs } from "../src/modules/counsel/schema.js";
import { legalFilings } from "../src/modules/filings/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { assertCanDraft, assertCanIssue, DomainError as OpinionDomainError } from "../src/modules/opinions/domain.js";
import { registerOpinionConsumers } from "../src/modules/opinions/consumer.js";
import { registerCounselBriefConsumers } from "../src/modules/counsel/consumer.js";
import { registerFilingConsumers } from "../src/modules/filings/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const ACTOR    = "00000000-aaaa-4000-8000-0000000000d0";
const TENANT_A = "11111111-aaaa-4000-8000-0000000000d0";
const TENANT_B = "11111111-bbbb-4000-8000-0000000000d0";
const CASE_A   = "22222222-aaaa-4000-8000-0000000000d0";
const OP_1     = "33333333-aaaa-4000-8000-0000000000d0";
const BRIEF_1  = "44444444-aaaa-4000-8000-0000000000d0";
const FILING_1 = "55555555-aaaa-4000-8000-0000000000d0";

const M = (n: number): string => `66666666-dddd-4000-8000-0000000000${String(n).padStart(2, "0")}`;

async function wipe(): Promise<void> {
  for (const t of [TENANT_A, TENANT_B]) {
    await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    await db.delete(legalOpinions).where(eq(legalOpinions.tenantId, t));
    await db.delete(legalCounselBriefs).where(eq(legalCounselBriefs.tenantId, t));
    await db.delete(legalFilings).where(eq(legalFilings.tenantId, t));
    await db.delete(legalCases).where(eq(legalCases.tenantId, t));
  }
  for (let i = 1; i <= 30; i++) {
    await db.delete(processed).where(eq(processed.messageId, M(i)));
  }
  // also clear the inbox for the fixed lifecycle messageIds, else a re-run is
  // (correctly) deduped by markProcessed and the row is never re-created.
  for (const mid of [OP_1, BRIEF_1, FILING_1]) {
    await db.delete(processed).where(eq(processed.messageId, mid));
  }
}

async function drain(_q: MemoryQueue): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 300));
}

beforeAll(async () => {
  await wipe();
  await db.insert(legalCases).values({
    id: CASE_A, tenantId: TENANT_A, caseNo: "WP-2026-D01",
    title: "Domain test case", court: "High Court Delhi",
    status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
  });
});
afterAll(async () => { await wipe(); await sqlClient.end(); });

// ── Opinion domain (pure) ──────────────────────────────────────────────────────
describe("Legal opinion domain — lifecycle guard (pure)", () => {
  it("sought → draft is valid", () => expect(() => assertCanDraft("sought")).not.toThrow());
  it("drafted → draft throws", () => expect(() => assertCanDraft("drafted")).toThrow(OpinionDomainError));
  it("drafted → issue is valid", () => expect(() => assertCanIssue("drafted")).not.toThrow());
  it("sought → issue throws (must draft first)", () => expect(() => assertCanIssue("sought")).toThrow(OpinionDomainError));
  it("issued → issue throws", () => expect(() => assertCanIssue("issued")).toThrow(OpinionDomainError));
});

// ── Opinion lifecycle CQRS ─────────────────────────────────────────────────────
describe("Legal opinion — sought → drafted → issued (integration)", () => {
  it("full lifecycle persists status transitions, timestamps and emits opinion.issued + audit", async () => {
    const q = new MemoryQueue();
    registerOpinionConsumers(q);
    await q.start();

    await q.publish(COMMANDS.opinionSeek, {
      messageId: OP_1, type: COMMANDS.opinionSeek,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "corr-op-seek", schemaVersion: "1.0",
      payload: { id: OP_1, tenantId: TENANT_A, opinionNo: "OP-2026-001", subject: "Vires of notification",
                 question: "Is the notification ultra vires?", caseId: CASE_A, soughtBy: "Secretary, Dept" },
    });
    await drain(q);
    let [op] = await db.select().from(legalOpinions).where(eq(legalOpinions.id, OP_1));
    expect(op?.status).toBe("sought");
    expect(op?.caseId).toBe(CASE_A);

    await q.publish(COMMANDS.opinionDraft, {
      messageId: M(1), type: COMMANDS.opinionDraft,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "corr-op-draft", schemaVersion: "1.0",
      payload: { opinionId: OP_1, tenantId: TENANT_A, counselName: "Sr. Adv. R. Mehta", opinionText: "In my considered opinion..." },
    });
    await drain(q);
    [op] = await db.select().from(legalOpinions).where(eq(legalOpinions.id, OP_1));
    expect(op?.status).toBe("drafted");
    expect(op?.counselName).toBe("Sr. Adv. R. Mehta");
    expect(op?.draftedAt).not.toBeNull();

    await q.publish(COMMANDS.opinionIssue, {
      messageId: M(2), type: COMMANDS.opinionIssue,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "corr-op-issue", schemaVersion: "1.0",
      payload: { opinionId: OP_1, tenantId: TENANT_A },
    });
    await drain(q);
    await q.stop();

    [op] = await db.select().from(legalOpinions).where(eq(legalOpinions.id, OP_1));
    expect(op?.status).toBe("issued");
    expect(op?.issuedAt).not.toBeNull();

    const events = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A));
    expect(events.map((e) => e.eventType)).toContain(EVENTS.opinionIssued);
    expect(events.map((e) => e.eventType)).toContain("audit.event.record");
    const issued = events.find((e) => e.eventType === EVENTS.opinionIssued);
    expect((issued?.payload as Record<string, unknown>)?.opinionNo).toBe("OP-2026-001");
  });

  it("idempotency: redelivering opinion.seek with same messageId inserts exactly one row", async () => {
    const q = new MemoryQueue();
    registerOpinionConsumers(q);
    await q.start();
    const ID = "33333333-cccc-4000-8000-0000000000d0";
    const dup = {
      messageId: M(5), type: COMMANDS.opinionSeek,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "corr-dup", schemaVersion: "1.0" as const,
      payload: { id: ID, tenantId: TENANT_A, opinionNo: "OP-2026-DUP", subject: "dup", question: "dup?" },
    };
    await q.publish(COMMANDS.opinionSeek, dup);
    await drain(q);
    await q.publish(COMMANDS.opinionSeek, dup);
    await drain(q);
    await q.stop();
    const rows = await db.select().from(legalOpinions).where(eq(legalOpinions.id, ID));
    expect(rows.length).toBe(1);
  });
});

// ── Counsel brief ──────────────────────────────────────────────────────────────
describe("Legal counsel brief — assignment (integration)", () => {
  it("assign persists brief tied to case + emits counsel_brief.assigned + audit", async () => {
    const q = new MemoryQueue();
    registerCounselBriefConsumers(q);
    await q.start();
    await q.publish(COMMANDS.counselBriefAssign, {
      messageId: BRIEF_1, type: COMMANDS.counselBriefAssign,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "corr-brief", schemaVersion: "1.0",
      payload: { id: BRIEF_1, tenantId: TENANT_A, caseId: CASE_A, counselName: "Adv. K. Iyer",
                 counselType: "senior_advocate", briefSummary: "Argue maintainability", feeMinor: 250000, currency: "INR" },
    });
    await drain(q);
    await q.stop();
    const [b] = await db.select().from(legalCounselBriefs).where(eq(legalCounselBriefs.id, BRIEF_1));
    expect(b?.status).toBe("assigned");
    expect(b?.caseId).toBe(CASE_A);
    expect(b?.counselName).toBe("Adv. K. Iyer");
    expect(b?.feeMinor).toBe(250000n);
    const events = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A));
    expect(events.map((e) => e.eventType)).toContain(EVENTS.counselBriefAssigned);
  });

  it("idempotency: redelivered assignment yields one brief row", async () => {
    const q = new MemoryQueue();
    registerCounselBriefConsumers(q);
    await q.start();
    const ID = "44444444-cccc-4000-8000-0000000000d0";
    const dup = {
      messageId: M(8), type: COMMANDS.counselBriefAssign,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "corr-brief-dup", schemaVersion: "1.0" as const,
      payload: { id: ID, tenantId: TENANT_A, caseId: CASE_A, counselName: "Adv. dup", briefSummary: "x" },
    };
    await q.publish(COMMANDS.counselBriefAssign, dup);
    await drain(q);
    await q.publish(COMMANDS.counselBriefAssign, dup);
    await drain(q);
    await q.stop();
    const rows = await db.select().from(legalCounselBriefs).where(eq(legalCounselBriefs.id, ID));
    expect(rows.length).toBe(1);
  });
});

// ── Filing / affidavit ─────────────────────────────────────────────────────────
describe("Legal filing/affidavit — record (integration)", () => {
  it("record an affidavit against a case, status filed, filed_at set, emits filing.recorded + audit", async () => {
    const q = new MemoryQueue();
    registerFilingConsumers(q);
    await q.start();
    await q.publish(COMMANDS.filingRecord, {
      messageId: FILING_1, type: COMMANDS.filingRecord,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "corr-filing", schemaVersion: "1.0",
      payload: { id: FILING_1, tenantId: TENANT_A, caseId: CASE_A, filingType: "affidavit",
                 title: "Counter affidavit of the State", court: "High Court Delhi",
                 filingDate: "2026-06-20", referenceNo: "AFF-2026-77", status: "filed" },
    });
    await drain(q);
    await q.stop();
    const [f] = await db.select().from(legalFilings).where(eq(legalFilings.id, FILING_1));
    expect(f?.filingType).toBe("affidavit");
    expect(f?.status).toBe("filed");
    expect(f?.filedAt).not.toBeNull();
    expect(f?.caseId).toBe(CASE_A);
    const events = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A));
    expect(events.map((e) => e.eventType)).toContain(EVENTS.filingRecorded);
  });
});

// ── Tenant isolation ───────────────────────────────────────────────────────────
describe("Legal — tenant isolation", () => {
  it("opinion.draft for an opinion owned by another tenant does not mutate it", async () => {
    const q = new MemoryQueue();
    registerOpinionConsumers(q);
    await q.start();
    const ID = "33333333-eeee-4000-8000-0000000000d0";
    // seed opinion under TENANT_A
    await q.publish(COMMANDS.opinionSeek, {
      messageId: M(10), type: COMMANDS.opinionSeek,
      tenantId: TENANT_A, actorId: ACTOR, correlationId: "c", schemaVersion: "1.0",
      payload: { id: ID, tenantId: TENANT_A, opinionNo: "OP-ISO-1", subject: "iso", question: "q?" },
    });
    await drain(q);
    // TENANT_B attempts to draft it — consumer guard rejects (tenant mismatch)
    await q.publish(COMMANDS.opinionDraft, {
      messageId: M(11), type: COMMANDS.opinionDraft,
      tenantId: TENANT_B, actorId: ACTOR, correlationId: "c", schemaVersion: "1.0",
      payload: { opinionId: ID, tenantId: TENANT_B, counselName: "intruder", opinionText: "hijack" },
    });
    await drain(q);
    await q.stop();
    const [op] = await db.select().from(legalOpinions).where(eq(legalOpinions.id, ID));
    expect(op?.status).toBe("sought");        // unchanged
    expect(op?.counselName).toBeNull();        // not hijacked
  });
});

// ── Zod rejection (route inject) ───────────────────────────────────────────────
describe("Legal — Zod validation + auth (route inject)", () => {
  it("GET /v1/legal/opinions unauthenticated → 401 (real route, no conflict)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/legal/opinions" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("POST /v1/legal/filings with bad body → 400 VALIDATION_FAILED", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "POST", url: "/v1/legal/filings",
      headers: { authorization: `Bearer ${token}` },
      payload: { caseId: "not-a-uuid", filingType: "banana", title: "", court: "", filingDate: "20-06-2026" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("POST /v1/legal/opinions with valid body → 202 accepted", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "POST", url: "/v1/legal/opinions",
      headers: { authorization: `Bearer ${token}` },
      payload: { opinionNo: "OP-ROUTE-1", subject: "route test", question: "valid?" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    await app.close();
  });
});

import { signToken } from "@civitasone/auth";
function makeToken(): string {
  return signToken(
    { sub: ACTOR, tid: TENANT_A, roles: ["legal_officer"] },
    "test_secret_for_civitasone_32chr",
    3600,
  );
}
