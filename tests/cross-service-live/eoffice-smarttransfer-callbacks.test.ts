/**
 * tests/cross-service-live/eoffice-smarttransfer-callbacks.test.ts — ST-M01-16.
 *
 * Proves the SmartTransfer OS ↔ eOffice loop-back for the two new source ref
 * types `hr_transfer_order` and `hr_posting_cycle` (packages/eoffice-sdk),
 * end-to-end against a REAL Postgres (estab-service's own civitas_estab, as the
 * NON-SUPERUSER estab_svc role, FORCE RLS live) and the real MemoryQueue with
 * the production relayOnce (D-17; harness PR-FF02-06a).
 *
 * The loop, for each decision outcome:
 *   raise (estab.file.from_module, via the REAL linkage consumer)
 *     → the file + proposal noting are created in estab, source linkage stored
 *   → eOffice DECIDES (the test publishes estab.file.approve / estab.file.reject,
 *      exactly what the workflow backbone emits; a RETURN is estab.file.reject
 *      carrying outcome:"returned". The test IS the decision driver.)
 *     → the REAL files consumer calls emitModuleDecisionCallback
 *   → a decision callback event is emitted on the OWNER topic
 *      (hrms.transfer_order.file_decided / hrms.posting_cycle.file_decided)
 *      carrying the right outcome (approved/rejected/returned) and reason.
 *
 * The OWNER side (smarttransfer-service, PR #1979) is NOT on main, so this test
 * does NOT mount it and does NOT depend on it: it subscribes to the owner topic
 * directly and asserts the emitted callback. The callback payload is validated
 * with the SDK's `parseDecisionCallback` (the frozen eoffice-sdk wire contract);
 * there is no `packages/events` contract for the `*.file_decided` callback
 * topics (the merged smarttransfer pack covers `smarttransfer.*` and
 * `hrms.posting.*` only), so none is asserted here — see the PR body.
 *
 * Fail-closed (R21): `hr_transfer_order`/`hr_posting_cycle` are NOT in the SDK's
 * hard-coded DECISION_CONSUMED_REF_TYPES (their consumer, smarttransfer-service,
 * is unmerged). They are enabled for this test via the documented env
 * EXTRA_DECISION_CONSUMED_REF_TYPES, set BEFORE estab's modules are imported.
 * The final case proves the raise is REJECTED (no file created) when a
 * type is NOT consumable — the production default on main.
 *
 * Governing (PROPOSED) decision: D-ST-08 option (a). Spec §11. D-17, D-ST-10.
 *
 * HOW TO RUN (own disposable Postgres, non-superuser roles, --maxWorkers=2):
 *   export PGHOST=localhost PGPORT=<free port> CACHE_DRIVER=memory QUEUE_DRIVER=memory
 *   PGPORT=$PGPORT bash scripts/ci/bootstrap-postgres.sh
 *   pnpm exec vitest run --maxWorkers=2 \
 *     tests/cross-service-live/eoffice-smarttransfer-callbacks.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@civitasone/db";
import {
  parseDecisionCallback,
  callbackTopicFor,
  MODULE_CALLBACK_TOPICS,
  isDecisionConsumed,
  EXTRA_DECISION_CONSUMED_ENV,
  type Decision,
  type SourceRefType,
} from "@civitasone/eoffice-sdk";
import { LiveHarness, assertFresh, tenant, type MountedService } from "./harness.js";

const ACTOR = randomUUID();

// Enable the two SmartTransfer source types for THIS worker, before estab's
// modules (which read isDecisionConsumed at consume time) are imported by
// mountService(). A plain list of ref-type names — carries no secret.
process.env[EXTRA_DECISION_CONSUMED_ENV] = "hr_transfer_order,hr_posting_cycle";

const CONSUMED_EVENTS = {
  fileApprove: "estab.file.approve",
  fileReject: "estab.file.reject",
} as const;
const FILE_FROM_MODULE = "estab.file.from_module";

let h: LiveHarness;
let estab: MountedService;

// Captured callbacks per owner topic.
const callbacks: Record<string, Array<Record<string, unknown>>> = {};

beforeAll(async () => {
  h = new LiveHarness();
  // CACHE_DRIVER=memory so the approval-rules resolver cache needs no Redis;
  // the resolver returns null (no rule) and the linkage consumer falls back to
  // the supplied approval chain, which is all this loop-back needs.
  estab = await h.mount("estab-service", { CACHE_DRIVER: "memory", QUEUE_DRIVER: "memory" });
  await assertFresh([estab]);

  // The two new types must be consumable in this worker (env set above), and the
  // SDK must already map them to the SmartTransfer owner topics.
  expect(isDecisionConsumed("hr_transfer_order"), "hr_transfer_order must be consumable via env").toBe(true);
  expect(isDecisionConsumed("hr_posting_cycle"), "hr_posting_cycle must be consumable via env").toBe(true);
  expect(MODULE_CALLBACK_TOPICS["hr_transfer_order"]).toBe("hrms.transfer_order.file_decided");
  expect(MODULE_CALLBACK_TOPICS["hr_posting_cycle"]).toBe("hrms.posting_cycle.file_decided");

  // Record boundary crossings (tap) BEFORE any subscribe, then register the
  // REAL estab consumers (they wrap the queue with estab's own tenantScoped).
  await h.tap();

  // Replicate estab worker.ts exactly: it wraps the shared queue's subscribe so
  // EVERY handler runs inside runWithTenant(msg.tenantId, …) — the linkage
  // consumer relies on this queue-level wrap (it does not call tenantScoped
  // itself), without which its db.transaction() has no app.tenant_id GUC and
  // the FORCE-RLS estab_files insert is refused.
  const { runWithTenant } = await import("@civitasone/db");
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = h.queue as any;
    const rawSubscribe = q.subscribe.bind(q);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  }

  const { registerFilesConsumers } = await import(
    "../../services/estab-service/src/modules/files/consumer.js"
  );
  const { registerLinkageConsumers } = await import(
    "../../services/estab-service/src/modules/linkage/consumer.js"
  );
  registerFilesConsumers(h.queue);
  registerLinkageConsumers(h.queue);

  // Subscribe to the SmartTransfer owner callback topics as a plain asserter.
  // It goes through the same tenant/tap-wrapped subscribe as the real
  // consumers; the handler only reads the payload, so the tenant wrap is a
  // harmless no-op for it.
  for (const t of ["hr_transfer_order", "hr_posting_cycle"] as const) {
    const topic = callbackTopicFor(t);
    callbacks[topic] = [];
    h.queue.subscribe(topic, async (msg: { payload: Record<string, unknown> }) => {
      callbacks[topic]!.push(msg.payload);
    });
  }

  await h.start();
});

afterAll(async () => {
  if (h) await h.stop();
  delete process.env[EXTRA_DECISION_CONSUMED_ENV];
});

/**
 * Publish the raise command the SDK/estab contract expects, let the real
 * linkage consumer create the file, and return the file id. Deterministic
 * per-command messageId (not the entity id) per house rule 1.
 */
async function raise(
  tenantId: string,
  refType: SourceRefType,
  refId: string,
): Promise<{ fileId: string; fileNo: string }> {
  const fileId = randomUUID();
  const fileNo = `ST/${new Date().getFullYear()}/${fileId.slice(0, 4)}`;
  await h.queue.publish(FILE_FROM_MODULE, {
    messageId: randomUUID(), // per-command id (not the entity id) — house rule 1
    type: FILE_FROM_MODULE,
    tenantId,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload: {
      id: fileId,
      tenantId,
      fileNo,
      subject: `${refType} approval`,
      dept: "HR",
      classification: "confidential",
      priority: "normal",
      currentWith: randomUUID(),
      sourceRefType: refType,
      sourceRefId: refId,
      initiatedBy: randomUUID(),
      approvalChain: "file_noting",
      initialNote: "Proposal for competent-authority approval.",
      sourceContext: {},
    },
  });
  // Drain the directly-published raise so the linkage consumer commits the file
  // before we read it, then relay any outbox follow-ons to quiescence.
  await h.queue.drain();
  await h.relayAll();
  return { fileId, fileNo };
}

/** Publish an eOffice decision (what the workflow backbone emits) + relay. */
async function decide(
  topic: string,
  tenantId: string,
  fileId: string,
  actorKey: string,
  actorId: string,
  reasonCode?: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await h.queue.publish(topic, {
    messageId: randomUUID(), // per-command id (not the entity id) — house rule 1
    type: topic,
    tenantId,
    actorId,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload: { fileId, tenantId, [actorKey]: actorId, reasonCode: reasonCode ?? null, ...extra },
  });
  // Drain the directly-published decision FIRST so the files consumer runs and
  // writes the callback to estab's OUTBOX; THEN relayAll() moves that outbox row
  // onto the queue and delivers it to the asserter. (relayAll alone would do
  // relayOnce BEFORE this drain in its first pass, find nothing, and break.)
  await h.queue.drain();
  await h.relayAll();
}

/** The single row estab wrote for a file in a given tenant (RLS-scoped). */
async function fileRow(tenantId: string, fileId: string): Promise<{ status: string } | null> {
  const { withTenantScope } = await import("@civitasone/db");
  const rows = await withTenantScope(estab.db, tenantId, async (tx: typeof estab.db) =>
    tx.execute(sql`SELECT status FROM files.estab_files WHERE id = ${fileId} AND tenant_id = ${tenantId}`),
  );
  const r = rows as unknown as Array<{ status: string }>;
  return r[0] ?? null;
}

/** Note status of the file's latest noting (RLS-scoped). */
async function notingStatus(tenantId: string, fileId: string): Promise<string | null> {
  const { withTenantScope } = await import("@civitasone/db");
  const rows = await withTenantScope(estab.db, tenantId, async (tx: typeof estab.db) =>
    tx.execute(sql`SELECT note_status FROM files.estab_notings
      WHERE file_id = ${fileId} AND tenant_id = ${tenantId} ORDER BY seq DESC LIMIT 1`),
  );
  const r = rows as unknown as Array<{ note_status: string }>;
  return r[0]?.note_status ?? null;
}

describe("eOffice ↔ SmartTransfer loop-back — hr_transfer_order (D-ST-08, PROPOSED)", () => {
  it("approved: raise → approve → callback 'approved' on hrms.transfer_order.file_decided", async () => {
    const tn = tenant();
    const refId = randomUUID();
    const topic = MODULE_CALLBACK_TOPICS["hr_transfer_order"];
    const { fileId } = await raise(tn, "hr_transfer_order", refId);

    // The file was really created in estab's RLS-protected table.
    expect(await fileRow(tn, fileId), "the raise must create a file row").not.toBeNull();

    const approver = randomUUID();
    await decide(CONSUMED_EVENTS.fileApprove, tn, fileId, "approvedBy", approver);

    const got = (callbacks[topic] ?? []).filter((p) => p.fileId === fileId);
    expect(got.length, "exactly one callback must reach the owner topic").toBe(1);
    const parsed = parseDecisionCallback(got[0]);
    expect(parsed.ok, parsed.ok ? "" : (parsed as { error: string }).error).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.decision).toBe<Decision>("approved");
      expect(parsed.value.refType).toBe("hr_transfer_order");
      expect(parsed.value.refId).toBe(refId);
      expect(parsed.value.decidedBy).toBe(approver);
    }
  });

  it("rejected: raise → reject(reason) → callback 'rejected' with reason", async () => {
    const tn = tenant();
    const refId = randomUUID();
    const topic = MODULE_CALLBACK_TOPICS["hr_transfer_order"];
    const { fileId } = await raise(tn, "hr_transfer_order", refId);

    expect(await notingStatus(tn, fileId), "raise leaves the proposal noting submitted").toBe("submitted");
    const rejecter = randomUUID();
    await decide(CONSUMED_EVENTS.fileReject, tn, fileId, "rejectedBy", rejecter, "INELIGIBLE_POST");

    const got = (callbacks[topic] ?? []).filter((p) => p.fileId === fileId);
    expect(got.length).toBe(1);
    const parsed = parseDecisionCallback(got[0]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.decision).toBe<Decision>("rejected");
      expect(parsed.value.reasonCode).toBe("INELIGIBLE_POST");
    }
    // Reject sends the file back to draft and freezes the noting rejected (terminal).
    expect((await fileRow(tn, fileId))?.status).toBe("draft");
    expect(await notingStatus(tn, fileId), "reject freezes the noting rejected").toBe("rejected");
  });

  it("returned: raise → return(reason) → callback 'returned' with reason", async () => {
    const tn = tenant();
    const refId = randomUUID();
    const topic = MODULE_CALLBACK_TOPICS["hr_transfer_order"];
    const { fileId } = await raise(tn, "hr_transfer_order", refId);

    expect(await notingStatus(tn, fileId), "raise leaves the proposal noting submitted").toBe("submitted");
    const returner = randomUUID();
    await decide(CONSUMED_EVENTS.fileReject, tn, fileId, "rejectedBy", returner, "NEEDS_REVISION", { outcome: "returned" });

    const got = (callbacks[topic] ?? []).filter((p) => p.fileId === fileId);
    expect(got.length).toBe(1);
    const parsed = parseDecisionCallback(got[0]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.decision).toBe<Decision>("returned");
      expect(parsed.value.reasonCode).toBe("NEEDS_REVISION");
    }
    expect((await fileRow(tn, fileId))?.status).toBe("draft");
    expect(await notingStatus(tn, fileId), "return reopens the noting as draft for revision").toBe("draft");
  });

  it("redelivery: the same messageId on estab.file.reject (returned) yields ONE callback and ONE decision-log row", async () => {
    const tn = tenant();
    const refId = randomUUID();
    const topic = MODULE_CALLBACK_TOPICS["hr_transfer_order"];
    const { fileId } = await raise(tn, "hr_transfer_order", refId);

    const returner = randomUUID();
    const envelope = {
      messageId: randomUUID(), // SAME id on both deliveries
      type: CONSUMED_EVENTS.fileReject,
      tenantId: tn,
      actorId: returner,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { fileId, tenantId: tn, rejectedBy: returner, reasonCode: "NEEDS_REVISION", outcome: "returned" },
    };
    for (let i = 0; i < 2; i++) {
      await h.queue.publish(CONSUMED_EVENTS.fileReject, envelope);
      await h.queue.drain();
      await h.relayAll();
    }

    const got = (callbacks[topic] ?? []).filter((p) => p.fileId === fileId);
    expect(got.length, "a redelivered decision must not emit a second callback").toBe(1);

    const { withTenantScope } = await import("@civitasone/db");
    const rows = await withTenantScope(estab.db, tn, async (tx: typeof estab.db) =>
      tx.execute(sql`
        SELECT decision FROM files.module_decision_log
        WHERE tenant_id = ${tn} AND file_id = ${fileId}`),
    );
    expect((rows as unknown as unknown[]).length, "exactly one decision-log row").toBe(1);
    expect(await notingStatus(tn, fileId)).toBe("draft");
  });
});

describe("eOffice ↔ SmartTransfer loop-back — hr_posting_cycle (D-ST-08, PROPOSED)", () => {
  it("approved: raise → approve → callback 'approved' on hrms.posting_cycle.file_decided", async () => {
    const tn = tenant();
    const refId = randomUUID();
    const topic = MODULE_CALLBACK_TOPICS["hr_posting_cycle"];
    const { fileId } = await raise(tn, "hr_posting_cycle", refId);
    expect(await fileRow(tn, fileId)).not.toBeNull();

    const approver = randomUUID();
    await decide(CONSUMED_EVENTS.fileApprove, tn, fileId, "approvedBy", approver);

    const got = (callbacks[topic] ?? []).filter((p) => p.fileId === fileId);
    expect(got.length).toBe(1);
    const parsed = parseDecisionCallback(got[0]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.decision).toBe<Decision>("approved");
      expect(parsed.value.refType).toBe("hr_posting_cycle");
      expect(parsed.value.refId).toBe(refId);
    }
  });

  it("the decision log persists the outcome + reason under tenant RLS", async () => {
    const tn = tenant();
    const refId = randomUUID();
    const { fileId } = await raise(tn, "hr_posting_cycle", refId);
    await decide(CONSUMED_EVENTS.fileReject, tn, fileId, "rejectedBy", randomUUID(), "DOC_MISSING", { outcome: "returned" });

    const { withTenantScope } = await import("@civitasone/db");
    const rows = await withTenantScope(estab.db, tn, async (tx: typeof estab.db) =>
      tx.execute(sql`
        SELECT decision, reason_code, callback_topic
        FROM files.module_decision_log
        WHERE tenant_id = ${tn} AND file_id = ${fileId}`),
    );
    const log = rows as unknown as Array<{ decision: string; reason_code: string | null; callback_topic: string }>;
    expect(log.length).toBe(1);
    expect(log[0]!.decision).toBe("returned");
    expect(log[0]!.reason_code).toBe("DOC_MISSING");
    expect(log[0]!.callback_topic).toBe("hrms.posting_cycle.file_decided");
  });
});

describe("fail-closed (R21) — a type with no decision consumer cannot be raised", () => {
  it("rejects the raise and creates no file when the type is not consumable", async () => {
    const tn = tenant();
    // hr_disciplinary IS consumable; prove the NEGATIVE with a type that is not
    // in DECISION_CONSUMED_REF_TYPES and not in the env extension. We clear the
    // env-extended type to exercise the guard directly on hr_transfer_order.
    const prev = process.env[EXTRA_DECISION_CONSUMED_ENV];
    delete process.env[EXTRA_DECISION_CONSUMED_ENV];
    try {
      expect(isDecisionConsumed("hr_transfer_order"), "cleared env → not consumable on main").toBe(false);
      const refId = randomUUID();
      const fileId = randomUUID();
      await h.queue.publish(FILE_FROM_MODULE, {
        messageId: randomUUID(), // per-command id — house rule 1
        type: FILE_FROM_MODULE,
        tenantId: tn,
        actorId: ACTOR,
        correlationId: randomUUID(),
        schemaVersion: "1.0",
        payload: {
          id: fileId, tenantId: tn, fileNo: `ST/X/${fileId.slice(0, 4)}`,
          subject: "unconsumable raise", dept: "HR",
          classification: "confidential", priority: "normal", currentWith: randomUUID(),
          sourceRefType: "hr_transfer_order", sourceRefId: refId,
          initiatedBy: randomUUID(), approvalChain: "file_noting",
          initialNote: "should be rejected", sourceContext: {},
        },
      });
      await h.queue.drain();
      await h.relayAll();
      // Fail-closed: no file row created.
      expect(await fileRow(tn, fileId), "fail-closed: no orphan file is created").toBeNull();
    } finally {
      if (prev === undefined) delete process.env[EXTRA_DECISION_CONSUMED_ENV];
      else process.env[EXTRA_DECISION_CONSUMED_ENV] = prev;
    }
  });
});
