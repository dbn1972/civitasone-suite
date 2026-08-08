import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import {
  workScopes, scopeProgress, workPhotos, workIssues,
  physicalCompletions, workClosures,
} from "./schema.js";
import { awards } from "../tender/schema.js";
import { workProposals, workSplits } from "../proposal/schema.js";
import {
  closureEligibility, parentSplitConsistency, validateProgressNotExceedTarget,
} from "./domain.js";
import { eq, and } from "drizzle-orm";

const AUDIT_TOPIC = "audit.event.record";

export function registerExecutionConsumers(q: Queue): void {
  q.subscribe(COMMANDS.issueCreate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(workIssues).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        issueTypeId: (p.issueTypeId as string) ?? undefined,
        description: p.description as string,
        attachmentKey: (p.attachmentKey as string) ?? undefined,
        raisedDate: new Date(),
        status: "open",
      });

      await enqueue(tx, {
        topic: EVENTS.issueCreated,
        eventType: EVENTS.issueCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "create", resourceType: "issue", resourceId: p.id, outcome: "success" } });
    });
  });

  q.subscribe(COMMANDS.issueClose, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const { id } = msg.payload as { id: string };
      const rows = await tx.select().from(workIssues)
        .where(and(eq(workIssues.tenantId, msg.tenantId), eq(workIssues.id, id)))
        .limit(1);
      const issue = rows[0];
      if (!issue || issue.status === "closed") return;

      await tx.update(workIssues)
        .set({ status: "closed", closedDate: new Date() })
        .where(and(eq(workIssues.tenantId, msg.tenantId), eq(workIssues.id, id)));

      await enqueue(tx, {
        topic: EVENTS.issueClosed,
        eventType: EVENTS.issueClosed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id, workId: issue.workId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "close", resourceType: "issue", resourceId: id, outcome: "success" } });
    });
  });

  // ORPHAN FIX (SVC-067): add an execution scope target for a work.
  q.subscribe(COMMANDS.scopeAdd, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(workScopes).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        scopeId: p.scopeId as string,
        targetValue: p.targetValue !== undefined ? String(p.targetValue) : null,
        description: (p.description as string) ?? null,
      });

      await enqueue(tx, {
        topic: EVENTS.scopeAdded,
        eventType: EVENTS.scopeAdded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "process", resourceType: "execution", resourceId: p.id, outcome: "success" } });
    });
  });

  // ORPHAN FIX (SVC-067): record monthly physical progress against a scope.
  // Enforces validateProgressNotExceedTarget when the scope carries a target.
  q.subscribe(COMMANDS.progressRecord, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      const workScopeId = p.workScopeId as string;
      const current = Number(p.currentAchievement as number);

      const scopeRows = await tx.select().from(workScopes)
        .where(and(eq(workScopes.tenantId, msg.tenantId), eq(workScopes.id, workScopeId)))
        .limit(1);
      const scope = scopeRows[0];

      // Sum prior achievement for this scope to build a cumulative figure.
      const priorRows = await tx.select().from(scopeProgress)
        .where(and(eq(scopeProgress.tenantId, msg.tenantId), eq(scopeProgress.workScopeId, workScopeId)));
      const prior = priorRows.reduce((sum, r) => sum + Number(r.currentAchievement ?? 0), 0);
      const cumulative = prior + current;

      const target = scope?.targetValue != null ? Number(scope.targetValue) : null;
      if (target != null && !validateProgressNotExceedTarget(cumulative, target)) {
        return; // reject: cumulative progress would exceed the scope target
      }
      const percentage = target != null && target > 0 ? ((cumulative / target) * 100).toFixed(2) : null;

      await tx.insert(scopeProgress).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workScopeId,
        month: p.month as number,
        year: p.year as number,
        priorAchievement: String(prior),
        currentAchievement: String(current),
        percentage,
      });

      await enqueue(tx, {
        topic: EVENTS.progressRecorded,
        eventType: EVENTS.progressRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workScopeId, cumulative },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "process", resourceType: "execution", resourceId: p.id, outcome: "success" } });
    });
  });

  // ORPHAN FIX: persist a geo-tagged work-progress photo.
  q.subscribe(COMMANDS.photoUpload, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(workPhotos).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        userId: msg.actorId,
        fileKey: p.fileKey as string,
        description: (p.description as string) ?? null,
        captureDate: new Date(),
        latitude: p.latitude !== undefined ? String(p.latitude) : null,
        longitude: p.longitude !== undefined ? String(p.longitude) : null,
        source: (p.source as string) ?? null,
      });

      await enqueue(tx, {
        topic: EVENTS.photoUploaded,
        eventType: EVENTS.photoUploaded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "process", resourceType: "execution", resourceId: p.id, outcome: "success" } });
    });
  });

  // ORPHAN FIX (SVC-070): record a physical-completion certificate.
  q.subscribe(COMMANDS.physicalComplete, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(physicalCompletions).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        completionDate: p.completionDate ? new Date(p.completionDate as string) : new Date(),
        certificateFileKey: (p.certificateFileKey as string) ?? null,
        completedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.physicalCompleted,
        eventType: EVENTS.physicalCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "complete", resourceType: "physical", resourceId: p.id, outcome: "success" } });
    });
  });

  // SVC-070: close a work. ENFORCES closureEligibility + parentSplitConsistency
  // (previously the consumer inserted unconditionally). On a completion-type
  // closure it emits works.asset.handover so asset-service registers the asset.
  q.subscribe(COMMANDS.workClose, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      const workId = p.workId as string;
      const closureType = p.closureType as string;

      // Gather the state the domain rules depend on.
      const agreementRows = await tx.select().from(awards)
        .where(and(eq(awards.tenantId, msg.tenantId), eq(awards.workId, workId)));
      const hasAgreement = agreementRows.some(
        (a) => a.status === "dao_finalized" || a.status === "do_finalized",
      );

      const pcRows = await tx.select().from(physicalCompletions)
        .where(and(eq(physicalCompletions.tenantId, msg.tenantId), eq(physicalCompletions.workId, workId)));
      const hasPhysicalCompletion = pcRows.length > 0;

      const splitRows = await tx.select().from(workSplits)
        .where(and(eq(workSplits.tenantId, msg.tenantId), eq(workSplits.parentWorkId, workId)));
      const hasSplits = splitRows.length > 0;
      const allSplitsClosed = splitRows.every((sp) => sp.status === "closed");

      const eligibility = closureEligibility({
        id: workId, status: "", hasAgreement, hasSplits, allSplitsClosed, hasPhysicalCompletion,
      });

      // A pre-agreement work may be legitimately closed as EITHER "closed"
      // (never tendered) or "dropped" (abandoned before physical completion).
      // closureEligibility collapses that case to a single canonical value
      // ("closed"), so widen the permitted set for pre-agreement only — without
      // loosening the post-agreement rules, which must still match exactly.
      const preAgreementClose =
        !hasAgreement && (closureType === "closed" || closureType === "dropped");

      // Reject if the domain says this work is not eligible for the requested
      // closure, or a parent still has open splits.
      if (eligibility === null || (eligibility !== closureType && !preAgreementClose)) return;
      if (!parentSplitConsistency("", splitRows.map((sp) => ({ id: sp.id, status: sp.status })), closureType)) return;

      await tx.insert(workClosures).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId,
        closureType,
        closedDate: new Date(),
        remarks: (p.remarks as string) ?? undefined,
      });

      await enqueue(tx, {
        topic: EVENTS.workClosed,
        eventType: EVENTS.workClosed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { workId, closureType },
      });

      // Completion closure → hand the newly-built public asset to asset-service.
      if (closureType === "completion") {
        const propRows = await tx.select().from(workProposals)
          .where(and(eq(workProposals.tenantId, msg.tenantId), eq(workProposals.id, workId)))
          .limit(1);
        const prop = propRows[0];
        const acquisitionCostMinor = agreementRows[0]?.acceptedAmountMinor
          ?? prop?.estimatedCostMinor
          ?? 0n;

        await enqueue(tx, {
          topic: EVENTS.assetHandover,
          eventType: EVENTS.assetHandover,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            workId,
            tenantId: msg.tenantId,
            name: prop?.description ?? `Work ${workId}`,
            code: prop?.workNumber ?? workId,
            acquisitionCostMinor: acquisitionCostMinor.toString(),
            acquisitionDate: new Date().toISOString().slice(0, 10),
            closureType,
          },
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "process", resourceType: "execution", resourceId: p.id, outcome: "success" } });
      }
    });
  });
}
