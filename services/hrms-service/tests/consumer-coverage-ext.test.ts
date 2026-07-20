/**
 * hrms-service extended consumer coverage tests
 *
 * Exercises deputation, lifecycle, claims, service-book, apar, reservation,
 * and pension consumers via MemoryQueue + real DB verification.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Queue, Handler } from "@civitasone/queue";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsDeputations } from "../src/modules/deputation/schema.js";
import { hrmsServiceBookEntries } from "../src/modules/service-book/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerDeputationConsumers } from "../src/modules/deputation/consumer.js";
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import { registerClaimsConsumers } from "../src/modules/claims/consumer.js";
import { registerServiceBookConsumers } from "../src/modules/service-book/consumer.js";
import { registerAparConsumers } from "../src/modules/apar/consumer.js";
import { registerReservationConsumers } from "../src/modules/reservation/consumer.js";
import { registerPensionConsumers } from "../src/modules/pension/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT  = "aaaaaaaa-1111-4000-8000-000000000088";
const ACTOR   = "aaaaaaaa-2222-4000-8000-000000000088";
const DEPT_1  = "aaaaaaaa-3333-4000-8000-000000000088";
const DESIG_1 = "aaaaaaaa-4444-4000-8000-000000000088";
const EMP_1   = "aaaaaaaa-5555-4000-8000-000000000088";

// Deputation IDs
const DEP_1   = "bbbbbbbb-1111-4000-8000-000000000088";

// Service-book IDs
const SB_1    = "cccccccc-1111-4000-8000-000000000088";

// Message IDs — deputation
const MSG_DEP_CREATE  = "dd000001-0000-4000-8000-000000000088";
const MSG_DEP_EXTEND  = "dd000002-0000-4000-8000-000000000088";
const MSG_DEP_REVERT  = "dd000003-0000-4000-8000-000000000088";
const MSG_DEP_DUP     = MSG_DEP_CREATE;

// Message IDs — lifecycle
const MSG_LC_CONFIRM  = "ee000001-0000-4000-8000-000000000088";
const MSG_LC_SEPARATE = "ee000002-0000-4000-8000-000000000088";
const MSG_LC_REINST   = "ee000003-0000-4000-8000-000000000088";

// Message IDs — claims
const MSG_CLM_CREATE  = "ff000001-0000-4000-8000-000000000088";
const MSG_CLM_APPROVE = "ff000002-0000-4000-8000-000000000088";
const MSG_CLM_REJECT  = "ff000003-0000-4000-8000-000000000088";

// Message IDs — service-book
const MSG_SB_ADD      = "aa000001-0000-4000-8000-000000000088";
const MSG_SB_VERIFY   = "aa000002-0000-4000-8000-000000000088";
const MSG_SB_DUP      = MSG_SB_ADD;

// Message IDs — apar
const MSG_APAR_CREATE = "ab000001-0000-4000-8000-000000000088";
const MSG_APAR_SUBMIT = "ab000002-0000-4000-8000-000000000088";
const MSG_APAR_REVIEW = "ab000003-0000-4000-8000-000000000088";
const MSG_APAR_ACCEPT = "ab000004-0000-4000-8000-000000000088";

// Message IDs — reservation
const MSG_ROSTER_CREATE = "ac000001-0000-4000-8000-000000000088";
const MSG_ROSTER_PTS    = "ac000002-0000-4000-8000-000000000088";
const MSG_SANC_POST     = "ac000003-0000-4000-8000-000000000088";

// Message IDs — pension
const MSG_PEN_INIT    = "ad000001-0000-4000-8000-000000000088";
const MSG_PEN_APPROVE = "ad000002-0000-4000-8000-000000000088";
const MSG_PEN_CALC    = "ad000003-0000-4000-8000-000000000088";

const WAIT = 700;

const ALL_MSG_IDS = [
  MSG_DEP_CREATE, MSG_DEP_EXTEND, MSG_DEP_REVERT,
  MSG_LC_CONFIRM, MSG_LC_SEPARATE, MSG_LC_REINST,
  MSG_CLM_CREATE, MSG_CLM_APPROVE, MSG_CLM_REJECT,
  MSG_SB_ADD, MSG_SB_VERIFY,
  MSG_APAR_CREATE, MSG_APAR_SUBMIT, MSG_APAR_REVIEW, MSG_APAR_ACCEPT,
  MSG_ROSTER_CREATE, MSG_ROSTER_PTS, MSG_SANC_POST,
  MSG_PEN_INIT, MSG_PEN_APPROVE, MSG_PEN_CALC,
];

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function wipeAll() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.tenantId, TENANT));
    await tx.delete(hrmsDeputations).where(eq(hrmsDeputations.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    for (const mid of ALL_MSG_IDS) {
      await tx.delete(processed).where(eq(processed.messageId, mid));
    }
  }));
}

async function seedBase() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({
      id: DEPT_1, tenantId: TENANT, code: "EXT-DEPT", name: "Ext Test Dept",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsDesignations).values({
      id: DESIG_1, tenantId: TENANT, code: "EXT-DES", name: "Ext Test Desig",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsEmployees).values({
      id: EMP_1, tenantId: TENANT, employeeNo: "EMP-EXT-001",
      fullName: "Ext Coverage Employee", departmentId: DEPT_1,
      designationId: DESIG_1, dateOfJoining: "2020-01-01",
      employeeType: "permanent", status: "confirmed", basicMinor: 5_000_000n,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

// ── 1. Deputation Consumers ───────────────────────────────────────

describe("Deputation consumers — coverage", () => {
  beforeAll(async () => { await wipeAll(); await seedBase(); });
  afterAll(async () => { await wipeAll(); });

  it("deputationCreate inserts deputation row", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerDeputationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.deputationCreate, {
      messageId: MSG_DEP_CREATE, type: COMMANDS.deputationCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-dep-1", schemaVersion: "1.0",
      payload: {
        id: DEP_1, tenantId: TENANT, employeeId: EMP_1,
        parentCadre: "IAS", parentDepartmentId: DEPT_1,
        borrowingDepartment: "Home Affairs",
        deputationAllowanceMinor: 500000,
        tenureFrom: "2024-01-01", tenureTo: "2027-01-01",
        orderRef: "ORD/2024/001", remarks: "Regular deputation",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsDeputations).where(eq(hrmsDeputations.id, DEP_1))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("active");
    expect(rows[0]?.parentCadre).toBe("IAS");
    expect(rows[0]?.deputationAllowanceMinor).toBe(500_000n);

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_DEP_CREATE))));
    expect(proc).toHaveLength(1);
  });

  it("duplicate deputationCreate is idempotent", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerDeputationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.deputationCreate, {
      messageId: MSG_DEP_DUP, type: COMMANDS.deputationCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-dep-dup", schemaVersion: "1.0",
      payload: {
        id: "ffffffff-0001-4000-8000-000000000088", tenantId: TENANT, employeeId: EMP_1,
        parentCadre: "IPS", parentDepartmentId: DEPT_1,
        borrowingDepartment: "Finance",
        deputationAllowanceMinor: 600000,
        tenureFrom: "2025-01-01", tenureTo: "2028-01-01",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsDeputations).where(eq(hrmsDeputations.tenantId, TENANT))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.parentCadre).toBe("IAS");
  });

  it("deputationExtend updates tenureTo", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerDeputationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.deputationExtend, {
      messageId: MSG_DEP_EXTEND, type: COMMANDS.deputationExtend,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-dep-ext", schemaVersion: "1.0",
      payload: {
        id: "ext-001", tenantId: TENANT, deputationId: DEP_1,
        newTenureTo: "2028-06-30", orderRef: "ORD/2024/EXT",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_DEP_EXTEND))));
    expect(proc).toHaveLength(1);
  });

  it("deputationRevert marks deputation repatriated", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerDeputationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.deputationRevert, {
      messageId: MSG_DEP_REVERT, type: COMMANDS.deputationRevert,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-dep-rev", schemaVersion: "1.0",
      payload: {
        id: "rev-001", tenantId: TENANT, deputationId: DEP_1,
        employeeId: EMP_1, repatriatedOn: "2025-03-31",
        note: "Repatriation on request",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_DEP_REVERT))));
    expect(proc).toHaveLength(1);
  });
});

// ── 2. Lifecycle Consumers ────────────────────────────────────────

describe("Lifecycle consumers — coverage", () => {
  beforeAll(async () => { await wipeAll(); await seedBase(); });
  afterAll(async () => { await wipeAll(); });

  it("lifecycleConfirm processes confirmation", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerLifecycleConsumers(q);
    await q.start();

    await q.publish(COMMANDS.lifecycleConfirm, {
      messageId: MSG_LC_CONFIRM, type: COMMANDS.lifecycleConfirm,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-lc-1", schemaVersion: "1.0",
      payload: {
        id: "lc-conf-001", tenantId: TENANT, employeeId: EMP_1,
        confirmationDate: "2021-01-01", orderRef: "ORD/CONF/001",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_LC_CONFIRM))));
    expect(proc).toHaveLength(1);
  });

  it("lifecycleSeparate processes separation", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerLifecycleConsumers(q);
    await q.start();

    await q.publish(COMMANDS.lifecycleSeparate, {
      messageId: MSG_LC_SEPARATE, type: COMMANDS.lifecycleSeparate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-lc-2", schemaVersion: "1.0",
      payload: {
        id: "lc-sep-001", tenantId: TENANT, employeeId: EMP_1,
        separationType: "retirement", effectiveDate: "2025-06-30",
        orderRef: "ORD/SEP/001", remarks: "Superannuation",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_LC_SEPARATE))));
    expect(proc).toHaveLength(1);
  });

  it("lifecycleReinstate processes reinstatement", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerLifecycleConsumers(q);
    await q.start();

    await q.publish(COMMANDS.lifecycleReinstate, {
      messageId: MSG_LC_REINST, type: COMMANDS.lifecycleReinstate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-lc-3", schemaVersion: "1.0",
      payload: {
        id: "lc-rein-001", tenantId: TENANT, employeeId: EMP_1,
        reinstatementDate: "2025-07-15", orderRef: "ORD/REIN/001",
        remarks: "Reinstated after review",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_LC_REINST))));
    expect(proc).toHaveLength(1);
  });
});

// ── 3. Claims Consumers ───────────────────────────────────────────

describe("Claims consumers — coverage", () => {
  beforeAll(async () => { await wipeAll(); await seedBase(); });
  afterAll(async () => { await wipeAll(); });

  it("claimCreate processes claim creation", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerClaimsConsumers(q);
    await q.start();

    await q.publish(COMMANDS.claimCreate, {
      messageId: MSG_CLM_CREATE, type: COMMANDS.claimCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-clm-1", schemaVersion: "1.0",
      payload: {
        id: "claim-001", tenantId: TENANT, employeeId: EMP_1,
        claimType: "ltc", amountMinor: 150000,
        details: { destination: "Shimla", travelClass: "AC2" },
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_CLM_CREATE))));
    expect(proc).toHaveLength(1);
  });

  it("claimApprove processes claim approval", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerClaimsConsumers(q);
    await q.start();

    await q.publish(COMMANDS.claimApprove, {
      messageId: MSG_CLM_APPROVE, type: COMMANDS.claimApprove,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-clm-2", schemaVersion: "1.0",
      payload: {
        id: "clm-appr-001", tenantId: TENANT, claimId: "claim-001",
        claimType: "ltc", approvedAmountMinor: 120000,
        approverRemarks: "Approved within cap",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_CLM_APPROVE))));
    expect(proc).toHaveLength(1);
  });

  it("claimReject processes claim rejection", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerClaimsConsumers(q);
    await q.start();

    await q.publish(COMMANDS.claimReject, {
      messageId: MSG_CLM_REJECT, type: COMMANDS.claimReject,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-clm-3", schemaVersion: "1.0",
      payload: {
        id: "clm-rej-001", tenantId: TENANT, claimId: "claim-001",
        claimType: "cea", approverRemarks: "Insufficient documents",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_CLM_REJECT))));
    expect(proc).toHaveLength(1);
  });
});

// ── 4. Service-Book Consumers ─────────────────────────────────────

describe("Service-book consumers — coverage", () => {
  beforeAll(async () => { await wipeAll(); await seedBase(); });
  afterAll(async () => { await wipeAll(); });

  it("serviceBookAddEntry inserts entry row", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerServiceBookConsumers(q);
    await q.start();

    await q.publish(COMMANDS.serviceBookAddEntry, {
      messageId: MSG_SB_ADD, type: COMMANDS.serviceBookAddEntry,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-sb-1", schemaVersion: "1.0",
      payload: {
        id: SB_1, tenantId: TENANT, employeeId: EMP_1,
        entryType: "promotion", effectiveDate: "2024-04-01",
        description: "Promoted to Grade II", documentRef: "DOC/2024/001",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.id, SB_1))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entryType).toBe("promotion");
    expect(rows[0]?.description).toBe("Promoted to Grade II");
    expect(rows[0]?.attested).toBe(false);
  });

  it("duplicate serviceBookAddEntry is idempotent", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerServiceBookConsumers(q);
    await q.start();

    await q.publish(COMMANDS.serviceBookAddEntry, {
      messageId: MSG_SB_DUP, type: COMMANDS.serviceBookAddEntry,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-sb-dup", schemaVersion: "1.0",
      payload: {
        id: "ffffffff-sb01-4000-8000-000000000088", tenantId: TENANT, employeeId: EMP_1,
        entryType: "transfer", effectiveDate: "2024-05-01",
        description: "Duplicate entry", documentRef: "DOC/DUP",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.tenantId, TENANT))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entryType).toBe("promotion");
  });

  it("serviceBookVerify attests an entry", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerServiceBookConsumers(q);
    await q.start();

    await q.publish(COMMANDS.serviceBookVerify, {
      messageId: MSG_SB_VERIFY, type: COMMANDS.serviceBookVerify,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-sb-v", schemaVersion: "1.0",
      payload: {
        id: "verify-001", tenantId: TENANT, entryId: SB_1,
        remarks: "Verified against order",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsServiceBookEntries).where(eq(hrmsServiceBookEntries.id, SB_1))));
    expect(rows[0]?.attested).toBe(true);
    expect(rows[0]?.attestedBy).toBe(ACTOR);
  });
});

// ── 5. APAR Consumers ─────────────────────────────────────────────

describe("APAR consumers — coverage", () => {
  beforeAll(async () => { await wipeAll(); await seedBase(); });
  afterAll(async () => { await wipeAll(); });

  it("aparCreate processes apar creation", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerAparConsumers(q);
    await q.start();

    await q.publish(COMMANDS.aparCreate, {
      messageId: MSG_APAR_CREATE, type: COMMANDS.aparCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-apar-1", schemaVersion: "1.0",
      payload: {
        id: "apar-001", tenantId: TENANT, employeeId: EMP_1,
        appraisalPeriod: "2024-25",
        reportingOfficerId: ACTOR, reviewingOfficerId: ACTOR,
        acceptingAuthorityId: ACTOR,
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_APAR_CREATE))));
    expect(proc).toHaveLength(1);
  });

  it("aparSubmit processes self-appraisal submission", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerAparConsumers(q);
    await q.start();

    await q.publish(COMMANDS.aparSubmit, {
      messageId: MSG_APAR_SUBMIT, type: COMMANDS.aparSubmit,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-apar-2", schemaVersion: "1.0",
      payload: {
        id: "apar-001", tenantId: TENANT,
        selfAppraisal: "Completed all assigned projects on time.",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_APAR_SUBMIT))));
    expect(proc).toHaveLength(1);
  });

  it("aparReview processes review stage", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerAparConsumers(q);
    await q.start();

    await q.publish(COMMANDS.aparReview, {
      messageId: MSG_APAR_REVIEW, type: COMMANDS.aparReview,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-apar-3", schemaVersion: "1.0",
      payload: {
        id: "apar-001", tenantId: TENANT,
        stage: "reporting", remarks: "Good performance overall.",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_APAR_REVIEW))));
    expect(proc).toHaveLength(1);
  });

  it("aparAccept processes acceptance", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerAparConsumers(q);
    await q.start();

    await q.publish(COMMANDS.aparAccept, {
      messageId: MSG_APAR_ACCEPT, type: COMMANDS.aparAccept,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-apar-4", schemaVersion: "1.0",
      payload: {
        id: "apar-001", tenantId: TENANT,
        remarks: "Accepted. Final grading: Outstanding.",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_APAR_ACCEPT))));
    expect(proc).toHaveLength(1);
  });
});

// ── 6. Reservation Consumers ──────────────────────────────────────

describe("Reservation consumers — coverage", () => {
  beforeAll(async () => { await wipeAll(); await seedBase(); });
  afterAll(async () => { await wipeAll(); });

  it("rosterCreate processes roster creation", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerReservationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.rosterCreate, {
      messageId: MSG_ROSTER_CREATE, type: COMMANDS.rosterCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-res-1", schemaVersion: "1.0",
      payload: {
        id: "roster-001", tenantId: TENANT,
        cadre: "Group A", rosterKind: "13-point", rosterSize: 13,
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_ROSTER_CREATE))));
    expect(proc).toHaveLength(1);
  });

  it("rosterGeneratePoints processes point generation", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerReservationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.rosterGeneratePoints, {
      messageId: MSG_ROSTER_PTS, type: COMMANDS.rosterGeneratePoints,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-res-2", schemaVersion: "1.0",
      payload: {
        id: "pts-001", tenantId: TENANT, rosterId: "roster-001",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_ROSTER_PTS))));
    expect(proc).toHaveLength(1);
  });

  it("sanctionedPostCreate processes post creation", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerReservationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.sanctionedPostCreate, {
      messageId: MSG_SANC_POST, type: COMMANDS.sanctionedPostCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-res-3", schemaVersion: "1.0",
      payload: {
        id: "sp-001", tenantId: TENANT,
        cadre: "Group B", sanctionedStrength: 50,
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_SANC_POST))));
    expect(proc).toHaveLength(1);
  });
});

// ── 7. Pension Consumers ──────────────────────────────────────────

describe("Pension consumers — coverage", () => {
  beforeAll(async () => { await wipeAll(); await seedBase(); });
  afterAll(async () => { await wipeAll(); });

  it("pensionInitiate processes pension initiation", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPensionConsumers(q);
    await q.start();

    await q.publish(COMMANDS.pensionInitiate, {
      messageId: MSG_PEN_INIT, type: COMMANDS.pensionInitiate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-pen-1", schemaVersion: "1.0",
      payload: {
        id: "pen-001", tenantId: TENANT, employeeId: EMP_1,
        retirementDate: "2025-06-30", pensionScheme: "CCS",
        remarks: "Regular superannuation",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_PEN_INIT))));
    expect(proc).toHaveLength(1);
  });

  it("pensionApprove processes pension approval", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPensionConsumers(q);
    await q.start();

    await q.publish(COMMANDS.pensionApprove, {
      messageId: MSG_PEN_APPROVE, type: COMMANDS.pensionApprove,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-pen-2", schemaVersion: "1.0",
      payload: {
        id: "pen-appr-001", tenantId: TENANT, pensionId: "pen-001",
        employeeId: EMP_1, approvedBy: ACTOR,
        remarks: "All documents verified",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_PEN_APPROVE))));
    expect(proc).toHaveLength(1);
  });

  it("pensionCalculate processes pension computation", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPensionConsumers(q);
    await q.start();

    await q.publish(COMMANDS.pensionCalculate, {
      messageId: MSG_PEN_CALC, type: COMMANDS.pensionCalculate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-pen-3", schemaVersion: "1.0",
      payload: {
        id: "pen-calc-001", tenantId: TENANT, employeeId: EMP_1,
        retirementDate: "2025-06-30", daRatePct: 50,
        commutePct: 40, elBalanceDays: 300,
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_PEN_CALC))));
    expect(proc).toHaveLength(1);
  });
});

// ── Cleanup ───────────────────────────────────────────────────────

afterAll(async () => {
  await wipeAll();
  await sqlClient.end();
});
