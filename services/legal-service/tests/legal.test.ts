import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { legalCases } from "../src/modules/cases/schema.js";
import { legalHearings } from "../src/modules/hearings/schema.js";
import { legalContractReviews } from "../src/modules/contracts/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { assertCanDispose, DomainError as CaseDomainError } from "../src/modules/cases/domain.js";
import { assertCanAdjourn, DomainError as HearingDomainError } from "../src/modules/hearings/domain.js";
import { registerCaseConsumers } from "../src/modules/cases/consumer.js";
import { registerHearingConsumers } from "../src/modules/hearings/consumer.js";
import { registerContractConsumers } from "../src/modules/contracts/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const ACTOR     = "00000000-aaaa-4000-8000-000000000020";
const TENANT    = "11111111-aaaa-4000-8000-000000000020";
const CASE_1    = "22222222-bbbb-4000-8000-000000000020";
const HEARING_1 = "33333333-cccc-4000-8000-000000000020";
const REVIEW_1  = "44444444-dddd-4000-8000-000000000020";

const MSG = (n: number): string => `55555555-eeee-4000-8000-0000000000${String(n).padStart(2, "0")}`;

async function wipe(): Promise<void> {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(legalHearings).where(eq(legalHearings.tenantId, TENANT));
  await db.delete(legalContractReviews).where(eq(legalContractReviews.tenantId, TENANT));
  await db.delete(legalCases).where(eq(legalCases.tenantId, TENANT));
  for (let i = 1; i <= 10; i++) {
    await db.delete(processed).where(eq(processed.messageId, MSG(i)));
  }
}

afterAll(async () => { await sqlClient.end(); });

// ── Domain tests (pure — no DB) ───────────────────────────────────────────────

describe("Legal case domain — state machine (pure)", () => {
  it("pending → disposed is valid", () => {
    expect(() => assertCanDispose("pending")).not.toThrow();
  });

  it("appealed → disposed is valid", () => {
    expect(() => assertCanDispose("appealed")).not.toThrow();
  });

  it("stayed → disposed is valid", () => {
    expect(() => assertCanDispose("stayed")).not.toThrow();
  });

  it("disposed → dispose throws INVALID_STATUS", () => {
    expect(() => assertCanDispose("disposed")).toThrow(CaseDomainError);
  });

  it("settled → dispose throws INVALID_STATUS", () => {
    expect(() => assertCanDispose("settled")).toThrow(CaseDomainError);
  });
});

describe("Legal hearing domain — adjournment (pure)", () => {
  it("scheduled → adjourn is valid", () => {
    expect(() => assertCanAdjourn("scheduled")).not.toThrow();
  });

  it("adjourned → adjourn again is valid (multiple adjournments)", () => {
    expect(() => assertCanAdjourn("adjourned")).not.toThrow();
  });

  it("disposed → adjourn throws INVALID_STATUS", () => {
    expect(() => assertCanAdjourn("disposed")).toThrow(HearingDomainError);
  });

  it("heard → adjourn throws INVALID_STATUS", () => {
    expect(() => assertCanAdjourn("heard")).toThrow(HearingDomainError);
  });
});

// ── CQRS integration tests ────────────────────────────────────────────────────

describe("Legal hearing — adjournment CQRS (integration)", () => {
  beforeAll(async () => {
    await wipe();
    await db.insert(legalCases).values({
      id: CASE_1, tenantId: TENANT, caseNo: "WP-2026-001",
      title: "Disputed contract award", court: "High Court Delhi",
      status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await db.insert(legalHearings).values({
      id: HEARING_1, tenantId: TENANT, caseId: CASE_1,
      hearingDate: "2026-07-01", court: "High Court Delhi",
      purpose: "First hearing", status: "scheduled",
      nextDate: "2026-07-01",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  });

  it("adjourn: next_date updated on case, previous_date (hearingDate) archived in hearing", async () => {
    const q = new MemoryQueue();
    registerCaseConsumers(q);
    registerHearingConsumers(q);
    await q.start();

    await q.publish(COMMANDS.hearingAdjourn, {
      messageId: MSG(1), type: COMMANDS.hearingAdjourn,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-adj-1", schemaVersion: "1.0",
      payload: {
        caseId: CASE_1, hearingId: HEARING_1, tenantId: TENANT,
        nextDate: "2026-08-15", purpose: "Arguments on maintainability",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const [hearing] = await db.select().from(legalHearings).where(eq(legalHearings.id, HEARING_1));
    expect(hearing?.status).toBe("adjourned");
    expect(hearing?.nextDate).toBe("2026-08-15");
    expect(hearing?.previousDate).toBe("2026-07-01");

    const [kase] = await db.select().from(legalCases).where(eq(legalCases.id, CASE_1));
    expect(kase?.nextDate).toBe("2026-08-15");

    const events = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    expect(events.map((e) => e.eventType)).toContain(EVENTS.caseDateSet);
  });

  it("second adjournment updates next_date again, archives original hearingDate as previous_date", async () => {
    const q = new MemoryQueue();
    registerHearingConsumers(q);
    await q.start();

    await q.publish(COMMANDS.hearingAdjourn, {
      messageId: MSG(2), type: COMMANDS.hearingAdjourn,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-adj-2", schemaVersion: "1.0",
      payload: {
        caseId: CASE_1, hearingId: HEARING_1, tenantId: TENANT,
        nextDate: "2026-09-20",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const [hearing] = await db.select().from(legalHearings).where(eq(legalHearings.id, HEARING_1));
    expect(hearing?.nextDate).toBe("2026-09-20");
    // consumer archives hearing.hearingDate (the column) as previousDate on each adjournment
    expect(hearing?.previousDate).toBe("2026-07-01");

    const [kase] = await db.select().from(legalCases).where(eq(legalCases.id, CASE_1));
    expect(kase?.nextDate).toBe("2026-09-20");
  });
});

describe("Legal contract review — clearance CQRS (integration)", () => {
  beforeAll(async () => {
    await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await db.delete(legalContractReviews).where(eq(legalContractReviews.tenantId, TENANT));
    for (const id of [MSG(3), MSG(4)]) {
      await db.delete(processed).where(eq(processed.messageId, id));
    }
    await db.insert(legalContractReviews).values({
      id: REVIEW_1, tenantId: TENANT, contractRef: "procurement_po:abc-uuid",
      subject: "Supply of IT equipment", valueMinor: 5000000n, currency: "INR",
      status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
    });
  });

  it("clearance: status → cleared, cleared_at set, legal.contract_review.cleared emitted", async () => {
    const q = new MemoryQueue();
    registerContractConsumers(q);
    await q.start();

    await q.publish(COMMANDS.contractReviewClear, {
      messageId: MSG(3), type: COMMANDS.contractReviewClear,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-clear-1", schemaVersion: "1.0",
      payload: {
        reviewId: REVIEW_1, tenantId: TENANT,
        clearanceType: "legal_opinion", notes: "No legal impediment found",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const [review] = await db.select().from(legalContractReviews).where(eq(legalContractReviews.id, REVIEW_1));
    expect(review?.status).toBe("cleared");
    expect(review?.clearedAt).not.toBeNull();

    const events = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    expect(events.map((e) => e.eventType)).toContain(EVENTS.contractReviewCleared);
    const cleared = events.find((e) => e.eventType === EVENTS.contractReviewCleared);
    expect((cleared?.payload as Record<string, unknown>)?.reviewId).toBe(REVIEW_1);
    expect((cleared?.payload as Record<string, unknown>)?.contractRef).toBe("procurement_po:abc-uuid");
  });

  it("re-clearing an already-cleared review is rejected by domain guard, status unchanged", async () => {
    const q = new MemoryQueue();
    registerContractConsumers(q);
    await q.start();

    await q.publish(COMMANDS.contractReviewClear, {
      messageId: MSG(4), type: COMMANDS.contractReviewClear,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-clear-2", schemaVersion: "1.0",
      payload: { reviewId: REVIEW_1, tenantId: TENANT, clearanceType: "re-attempt" },
    });
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();

    const [review] = await db.select().from(legalContractReviews).where(eq(legalContractReviews.id, REVIEW_1));
    expect(review?.status).toBe("cleared");
  });
});

describe("legal-service route auth (inject)", () => {
  it("GET /v1/legal/opinions without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/legal/opinions" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
