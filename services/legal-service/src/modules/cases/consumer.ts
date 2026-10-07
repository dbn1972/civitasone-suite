import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { invalidateItemAndLists } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanDispose } from "./domain.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { DEFAULT_CASE_TYPES } from "./commands.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerCaseConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  // GAP-LEGAL-CASES-NEW-01: create a single case-type master entry (idempotent
  // on (tenant, code)), with an audit event in the SAME tx.
  queue.subscribe(COMMANDS.caseTypeCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; code: string; name: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCaseType(tx, {
        id: p.id, tenantId: p.tenantId, code: p.code, name: p.name,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "case_type", p.id, { code: p.code, name: p.name });
    });
    await invalidateItemAndLists(msg.tenantId, null, ["case_types"]);
  });

  // GAP-LEGAL-CASES-NEW-01: idempotently seed the DEFAULT_CASE_TYPES baseline.
  queue.subscribe(COMMANDS.caseTypeSeedDefaults, async (msg) => {
    const p = msg.payload as { tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      for (const t of DEFAULT_CASE_TYPES) {
        await repo.insertCaseType(tx, {
          id: randomUUID(), tenantId: p.tenantId, code: t.code, name: t.name,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      }
      await audit(tx, msg, "seed_defaults", "case_type", p.tenantId);
    });
    await invalidateItemAndLists(msg.tenantId, null, ["case_types"]);
  });

  queue.subscribe(COMMANDS.caseCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; caseNo: string; title: string; court: string;
      subject?: string; caseTypeId?: string; petitioner?: string; counselRef?: string;
      parties?: Array<{ name: string; role?: string }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCase(tx, {
        id: p.id, tenantId: p.tenantId, caseNo: p.caseNo, title: p.title, court: p.court,
        subject: p.subject ?? null, caseTypeId: p.caseTypeId ?? null,
        petitioner: p.petitioner ?? null, counselRef: p.counselRef ?? null,
        status: "pending", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (p.parties?.length) {
        for (const party of p.parties) {
          await repo.insertParty(tx, {
            id: randomUUID(), tenantId: p.tenantId, caseId: p.id,
            name: party.name, role: party.role ?? "respondent",
            createdBy: msg.actorId, updatedBy: msg.actorId,
          });
        }
      }
      await audit(tx, msg, "create", "case", p.id);
    });
    // queries.ts's listCases() reads through a separate plural "cases"
    // list-cache key per status/caseTypeId filter combo, which this consumer
    // never invalidated — the same stale-list-cache bug found and fixed for
    // counsel-briefs (fix/legal-wire-real-counsel-brief-endpoint), confirmed
    // live there via POST-then-immediate-GET. No case-scoped invalidation
    // primitive exists for this key shape, so this busts every cached list
    // in the tenant rather than leaving any of them wrong.
    await invalidateItemAndLists(msg.tenantId, { resource: "case", id: p.id }, ["cases"]);
  });

  queue.subscribe(COMMANDS.caseDispose, async (msg) => {
    const p = msg.payload as { caseId: string; tenantId: string; disposition: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const legalCase = await repo.findCaseByIdTx(tx, p.caseId);
      if (!legalCase) throw new Error(`case ${p.caseId} not found`);
      assertCanDispose(legalCase.status ?? "pending");
      await repo.updateCase(tx, p.caseId, {
        status: "disposed", disposition: p.disposition,
        updatedBy: msg.actorId, version: (legalCase.version ?? 1) + 1,
      });
      // disposition was previously discarded entirely here — see
      // migration 0023_case_disposition.sql for the full story. newValue
      // (not a bespoke "metadata" key) matches the convention
      // rti/consumer.ts already uses for the same concept, which matters
      // beyond naming consistency: audit-service's export pipeline
      // (exports/consumer.ts) only PII-gates payload.oldValue/newValue
      // behind an extra role check, not an arbitrary key name.
      await audit(tx, msg, "dispose", "case", p.caseId, { disposition: p.disposition });
    });
    // Disposing a case changes its status, which is a listCases() filter —
    // same list-cache gap as caseCreate above.
    await invalidateItemAndLists(msg.tenantId, { resource: "case", id: p.caseId }, ["cases"]);
  });
}

async function audit(
  tx: any,
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
  newValue?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success", ...(newValue ? { newValue } : {}) },
  });
}
