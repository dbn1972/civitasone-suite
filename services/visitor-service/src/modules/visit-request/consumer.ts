/**
 * visitor-service: visit-request consumer.
 *
 * Handles `COMMANDS.visitRequestCreate` / `Approve` / `Reject` / `Cancel` /
 * `AutoReject`:
 *
 * visitRequestCreate:
 *   markProcessed(tx, msg.messageId) → validate fields (domain.ts) →
 *   resolve initial status (domain.ts) → insert `visit_requests` row →
 *   outbox `visitRequestCreated` event → `NOTIFICATION_SEND` to host
 *   (push + in-app within 10s SLA, Requirement 1.3/16.1).
 *
 * visitRequestApprove:
 *   markProcessed(tx, msg.messageId) → load row → domain.approve state
 *   transition → IF permitted_areas include a Restricted_Area (area
 *   security_level > 1), THEN publish `workflow.instance.create` instead of
 *   directly approving (Requirement 3.6, 11.2); OTHERWISE transition to
 *   approved, update row, outbox `visitRequestApproved` + trigger
 *   `visitor.pass.generate` command (Requirement 3.2).
 *
 * visitRequestReject:
 *   markProcessed(tx, msg.messageId) → load row → domain.reject →
 *   update row (status, rejectionReason) → outbox `visitRequestRejected` →
 *   `NOTIFICATION_SEND` to visitor (SMS + email, Requirement 3.3).
 *
 * visitRequestCancel:
 *   markProcessed(tx, msg.messageId) → load row → domain assert cancel
 *   transition → update row → outbox `visitRequestCancelled`.
 *
 * visitRequestAutoReject:
 *   markProcessed(tx, msg.messageId) → load row → domain assert auto-reject
 *   transition → update row → outbox `visitRequestAutoRejected` →
 *   `NOTIFICATION_SEND` to visitor (SMS + email with "host did not respond").
 *
 * Follows the CQRS consumer pattern from modules/blacklist/consumer.ts.
 */
import { pino } from "pino";
import { and, eq, inArray } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { queue as queueSingleton } from "../../shared/infra.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import { visitRequests } from "./schema.js";
import { areas } from "../location/schema.js";
import {
  assertTransitionAllowed,
  resolveInitialStatus,
  generateTrackingRef,
  type VisitRequestSource,
  type VisitorCategory,
} from "./domain.js";
import { getAutoApproveCategories } from "../config-registry/policy.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "visit-request-consumer" });

/** Restricted area threshold — areas with securityLevel > 1 need workflow approval. */
const RESTRICTED_SECURITY_LEVEL = 1;

// ── Payload Types ────────────────────────────────────────────────────────

export interface VisitRequestCreatePayload {
  id: string;
  tenantId: string;
  locationId: string;
  visitorName: string;
  visitorPhone: string;
  visitorEmail: string | null;
  purpose: string;
  hostEmployeeId: string;
  scheduledAt: string;
  passType: "single" | "multi_day" | "recurring" | "event";
  identityDocType: string | null;
  identityDocRef: string | null;
  visitorCategory: "standard" | "vip" | "contractor" | "delegation";
  source: "portal" | "host_preregister" | "kiosk" | "mobile";
  permittedAreas: string[];
  screeningReview?: boolean;
  screeningReviewNote?: string | null;
  createdBy: string;
}

export interface VisitRequestApprovePayload {
  id: string;
  tenantId: string;
}

export interface VisitRequestRejectPayload {
  id: string;
  tenantId: string;
  reason: string;
}

export interface VisitRequestCancelPayload {
  id: string;
  tenantId: string;
}

export interface VisitRequestAutoRejectPayload {
  id: string;
  tenantId: string;
}

// ── Workflow event payloads (consumed from workflow-service) ──────────────

export interface WorkflowTaskCompletedPayload {
  taskId: string;
  instanceId: string;
  decision: string;
  refType?: string;
  refId?: string;
}

export interface WorkflowInstanceRejectedPayload {
  instanceId: string;
  reason: string;
  definitionCode?: string;
  refType?: string;
  refId?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Determines whether any of the permittedAreas on a request include a
 * Restricted_Area (securityLevel > 1). If yes, multi-level approval via
 * workflow-service is required (Requirement 3.6, 11.2).
 */
async function hasRestrictedArea(
  tenantId: string,
  locationId: string,
  permittedAreaIds: string[],
): Promise<{ restricted: boolean; securityLevel: number; approvers: string[] }> {
  if (permittedAreaIds.length === 0) {
    return { restricted: false, securityLevel: 0, approvers: [] };
  }

  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) =>
    tx
      .select({
        id: areas.id,
        securityLevel: areas.securityLevel,
        authorizedApprovers: areas.authorizedApprovers,
      })
      .from(areas)
      .where(
        and(
          eq(areas.tenantId, tenantId),
          eq(areas.locationId, locationId),
          inArray(areas.id, permittedAreaIds),
        ),
      ),
  );

  // Find the maximum security level among requested areas
  let maxLevel = 0;
  let approvers: string[] = [];
  for (const row of rows) {
    if (row.securityLevel > maxLevel) {
      maxLevel = row.securityLevel;
      approvers = row.authorizedApprovers ?? [];
    }
  }

  return {
    restricted: maxLevel > RESTRICTED_SECURITY_LEVEL,
    securityLevel: maxLevel,
    approvers,
  };
}

// ── Consumer Registration ────────────────────────────────────────────────

export function registerVisitRequestConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  // ─── visitRequestCreate ──────────────────────────────────────────────
  queue.subscribe<VisitRequestCreatePayload>(COMMANDS.visitRequestCreate, async (msg) => {
    const p = msg.payload;

    const trackingRef = generateTrackingRef();
    // Hoisted so the post-commit auto-approve pass-generation can act on the
    // config-driven decision resolved inside the tx below.
    let autoApproved = false;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // Approval policy is config-driven: resolve the tenant's effective
      // auto-approve visitor-category set (defaults to {vip}) on the same
      // GUC-scoped tx, so a tenant can auto-approve e.g. contractors without a
      // code change. Unconfigured tenants get identical behavior.
      const autoApproveCategories = await getAutoApproveCategories(tx, msg.tenantId);
      const initialStatus = resolveInitialStatus(
        p.source as VisitRequestSource,
        p.visitorCategory as VisitorCategory,
        autoApproveCategories,
      );
      autoApproved = initialStatus === "approved";

      await tx.insert(visitRequests).values({
        id: p.id,
        tenantId: msg.tenantId,
        locationId: p.locationId,
        hostEmployeeId: p.hostEmployeeId,
        status: initialStatus,
        purpose: p.purpose,
        scheduledAt: new Date(p.scheduledAt),
        passType: p.passType,
        visitorCategory: p.visitorCategory,
        source: p.source,
        visitorName: p.visitorName,
        visitorPhone: p.visitorPhone,
        visitorEmail: p.visitorEmail,
        identityDocType: p.identityDocType,
        identityDocRef: p.identityDocRef,
        trackingRef,
        permittedAreas: p.permittedAreas,
        screeningReview: p.screeningReview ?? false,
        screeningReviewNote: p.screeningReviewNote ?? null,
        createdBy: p.createdBy,
        updatedBy: p.createdBy,
      });

      // Outbox: visitRequestCreated event
      await enqueue(tx, {
        topic: EVENTS.visitRequestCreated,
        eventType: EVENTS.visitRequestCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          tenantId: msg.tenantId,
          locationId: p.locationId,
          hostEmployeeId: p.hostEmployeeId,
          visitorName: p.visitorName,
          status: initialStatus,
          trackingRef,
          scheduledAt: p.scheduledAt,
        },
      });

      // Requirement 1.3/16.1: Notify host via push + in-app within 10s
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.visitRequestCreated,
          recipientId: p.hostEmployeeId,
          recipient: p.hostEmployeeId,
          channel: "push",
          variables: {
            visitorName: p.visitorName,
            purpose: p.purpose,
            scheduledAt: p.scheduledAt,
            trackingRef,
          },
        }),
      });

      // Second channel: in-app notification to host
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.visitRequestCreated,
          recipientId: p.hostEmployeeId,
          recipient: p.hostEmployeeId,
          channel: "in_app",
          variables: {
            visitorName: p.visitorName,
            purpose: p.purpose,
            scheduledAt: p.scheduledAt,
            trackingRef,
          },
        }),
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "create", resourceType: "visit_request", resourceId: p.id, outcome: "success" } });
    });

    // If the visitor's category was auto-approved (config-driven), trigger pass
    // generation immediately.
    if (autoApproved) {
      try {
        await queueSingleton.publish(COMMANDS.passGenerate, {
          messageId: `${p.id}:pass-gen`,
          type: COMMANDS.passGenerate,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          schemaVersion: "1.0",
          payload: {
            visitRequestId: p.id,
            tenantId: msg.tenantId,
            locationId: p.locationId,
            visitorName: p.visitorName,
            visitorPhone: p.visitorPhone,
            visitorEmail: p.visitorEmail,
            hostEmployeeId: p.hostEmployeeId,
            passType: p.passType,
            permittedAreas: p.permittedAreas,
            scheduledAt: p.scheduledAt,
          },
        });
      } catch (err) {
        log.warn(
          { err, tenantId: msg.tenantId, visitRequestId: p.id, event: "pass_generate_publish_failed" },
          "failed to publish pass.generate after VIP auto-approve; visit request is approved but pass generation may be delayed",
        );
      }
    }
  });

  // ─── visitRequestApprove ─────────────────────────────────────────────
  queue.subscribe<VisitRequestApprovePayload>(COMMANDS.visitRequestApprove, async (msg) => {
    const p = msg.payload;

    const result = await db.transaction(async (tx): Promise<{
      approved: boolean;
      workflowRequired: boolean;
      visitRequest: {
        locationId: string;
        visitorName: string;
        visitorPhone: string;
        visitorEmail: string | null;
        hostEmployeeId: string;
        passType: string;
        permittedAreas: string[];
        scheduledAt: Date | null;
      } | null;
    }> => {
      if (!(await markProcessed(tx, msg.messageId))) {
        return { approved: false, workflowRequired: false, visitRequest: null }; // idempotent replay
      }

      const rows = await tx
        .select()
        .from(visitRequests)
        .where(and(eq(visitRequests.id, p.id), eq(visitRequests.tenantId, msg.tenantId)))
        .limit(1);
      const request = rows[0];
      if (!request) {
        throw new Error(`visit request '${p.id}' not found for tenant '${msg.tenantId}'`);
      }

      // Domain state transition — throws DomainError if invalid
      assertTransitionAllowed(request.status, "approved");

      // Check if any permitted areas are restricted (security_level > 1)
      const permittedAreaIds = (request.permittedAreas ?? []) as string[];
      const { restricted, securityLevel, approvers } = await hasRestrictedArea(
        msg.tenantId,
        request.locationId,
        permittedAreaIds,
      );

      if (restricted) {
        // Requirement 3.6/11.2: Route through workflow-service for multi-level approval
        await enqueue(tx, {
          topic: "workflow.instance.create",
          eventType: "workflow.instance.create",
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            processDefinitionKey: "visitor_restricted_area_approval",
            businessKey: p.id,
            variables: {
              visitorName: request.visitorName,
              hostId: request.hostEmployeeId,
              securityLevel,
              approvers,
              visitRequestId: p.id,
              locationId: request.locationId,
            },
          },
        });

        return {
          approved: false,
          workflowRequired: true,
          visitRequest: null,
        };
      }

      // Direct approval — transition to approved
      await versionedUpdate(tx, visitRequests, {
        id: p.id,
        tenantId: msg.tenantId,
        expectedVersion: request.version,
        set: {
          status: "approved",
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "visit_request",
      });

      // Outbox: visitRequestApproved event
      await enqueue(tx, {
        topic: EVENTS.visitRequestApproved,
        eventType: EVENTS.visitRequestApproved,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          tenantId: msg.tenantId,
          locationId: request.locationId,
          hostEmployeeId: request.hostEmployeeId,
          visitorName: request.visitorName,
          status: "approved",
        },
      });

      // Requirement 3.2: Notify visitor of approval via SMS + email
      if (request.visitorPhone) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.visitRequestApproved,
            recipient: request.visitorPhone,
            channel: "sms",
            variables: {
              visitorName: request.visitorName,
              hostEmployeeId: request.hostEmployeeId,
              scheduledAt: request.scheduledAt?.toISOString() ?? "",
            },
          }),
        });
      }

      if (request.visitorEmail) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.visitRequestApproved,
            recipient: request.visitorEmail,
            channel: "email",
            variables: {
              visitorName: request.visitorName,
              hostEmployeeId: request.hostEmployeeId,
              scheduledAt: request.scheduledAt?.toISOString() ?? "",
            },
          }),
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "visit_request", resourceId: p.id, outcome: "success" } });
      }

      return {
        approved: true,
        workflowRequired: false,
        visitRequest: {
          locationId: request.locationId,
          visitorName: request.visitorName,
          visitorPhone: request.visitorPhone,
          visitorEmail: request.visitorEmail ?? null,
          hostEmployeeId: request.hostEmployeeId,
          passType: request.passType,
          permittedAreas: permittedAreaIds,
          scheduledAt: request.scheduledAt,
        },
      };
    });

    if (!result.approved) return; // idempotent replay or workflow-routed

    // Post-commit: trigger visitor.pass.generate command (Requirement 3.2)
    if (result.visitRequest) {
      try {
        await queueSingleton.publish(COMMANDS.passGenerate, {
          messageId: `${p.id}:pass-gen`,
          type: COMMANDS.passGenerate,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          schemaVersion: "1.0",
          payload: {
            visitRequestId: p.id,
            tenantId: msg.tenantId,
            locationId: result.visitRequest.locationId,
            visitorName: result.visitRequest.visitorName,
            visitorPhone: result.visitRequest.visitorPhone,
            visitorEmail: result.visitRequest.visitorEmail,
            hostEmployeeId: result.visitRequest.hostEmployeeId,
            passType: result.visitRequest.passType,
            permittedAreas: result.visitRequest.permittedAreas,
            scheduledAt: result.visitRequest.scheduledAt?.toISOString() ?? "",
          },
        });
      } catch (err) {
        log.warn(
          { err, tenantId: msg.tenantId, visitRequestId: p.id, event: "pass_generate_publish_failed" },
          "failed to publish pass.generate after approval; visit request is approved but pass generation may be delayed",
        );
      }
    }
  });

  // ─── visitRequestReject ──────────────────────────────────────────────
  queue.subscribe<VisitRequestRejectPayload>(COMMANDS.visitRequestReject, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      const rows = await tx
        .select()
        .from(visitRequests)
        .where(and(eq(visitRequests.id, p.id), eq(visitRequests.tenantId, msg.tenantId)))
        .limit(1);
      const request = rows[0];
      if (!request) {
        throw new Error(`visit request '${p.id}' not found for tenant '${msg.tenantId}'`);
      }

      // Domain state transition — throws DomainError if invalid
      assertTransitionAllowed(request.status, "rejected");

      await versionedUpdate(tx, visitRequests, {
        id: p.id,
        tenantId: msg.tenantId,
        expectedVersion: request.version,
        set: {
          status: "rejected",
          rejectionReason: p.reason,
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "visit_request",
      });

      // Outbox: visitRequestRejected event
      await enqueue(tx, {
        topic: EVENTS.visitRequestRejected,
        eventType: EVENTS.visitRequestRejected,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          tenantId: msg.tenantId,
          hostEmployeeId: request.hostEmployeeId,
          visitorName: request.visitorName,
          status: "rejected",
          rejectionReason: p.reason,
        },
      });

      // Requirement 3.3: Notify visitor of rejection via SMS + email
      if (request.visitorPhone) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.visitRequestRejected,
            recipient: request.visitorPhone,
            channel: "sms",
            variables: {
              visitorName: request.visitorName,
              reason: p.reason,
            },
          }),
        });
      }

      if (request.visitorEmail) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.visitRequestRejected,
            recipient: request.visitorEmail,
            channel: "email",
            variables: {
              visitorName: request.visitorName,
              reason: p.reason,
            },
          }),
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "visit_request", resourceId: p.id, outcome: "success" } });
      }
    });
  });

  // ─── visitRequestCancel ──────────────────────────────────────────────
  queue.subscribe<VisitRequestCancelPayload>(COMMANDS.visitRequestCancel, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      const rows = await tx
        .select()
        .from(visitRequests)
        .where(and(eq(visitRequests.id, p.id), eq(visitRequests.tenantId, msg.tenantId)))
        .limit(1);
      const request = rows[0];
      if (!request) {
        throw new Error(`visit request '${p.id}' not found for tenant '${msg.tenantId}'`);
      }

      // Domain state transition — throws DomainError if invalid
      assertTransitionAllowed(request.status, "cancelled");

      await versionedUpdate(tx, visitRequests, {
        id: p.id,
        tenantId: msg.tenantId,
        expectedVersion: request.version,
        set: {
          status: "cancelled",
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "visit_request",
      });

      // Outbox: visitRequestCancelled event
      await enqueue(tx, {
        topic: EVENTS.visitRequestCancelled,
        eventType: EVENTS.visitRequestCancelled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          tenantId: msg.tenantId,
          hostEmployeeId: request.hostEmployeeId,
          visitorName: request.visitorName,
          status: "cancelled",
        },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "visit_request", resourceId: p.id, outcome: "success" } });
    });
  });

  // ─── visitRequestAutoReject ──────────────────────────────────────────
  queue.subscribe<VisitRequestAutoRejectPayload>(COMMANDS.visitRequestAutoReject, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      const rows = await tx
        .select()
        .from(visitRequests)
        .where(and(eq(visitRequests.id, p.id), eq(visitRequests.tenantId, msg.tenantId)))
        .limit(1);
      const request = rows[0];
      if (!request) {
        throw new Error(`visit request '${p.id}' not found for tenant '${msg.tenantId}'`);
      }

      // Domain state transition — throws DomainError if invalid
      assertTransitionAllowed(request.status, "auto_rejected");

      await versionedUpdate(tx, visitRequests, {
        id: p.id,
        tenantId: msg.tenantId,
        expectedVersion: request.version,
        set: {
          status: "auto_rejected",
          rejectionReason: "Host did not respond within 24 hours",
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "visit_request",
      });

      // Outbox: visitRequestAutoRejected event
      await enqueue(tx, {
        topic: EVENTS.visitRequestAutoRejected,
        eventType: EVENTS.visitRequestAutoRejected,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          tenantId: msg.tenantId,
          hostEmployeeId: request.hostEmployeeId,
          visitorName: request.visitorName,
          status: "auto_rejected",
        },
      });

      // Notify visitor that host did not respond (SMS + email)
      if (request.visitorPhone) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.visitRequestAutoRejected,
            recipient: request.visitorPhone,
            channel: "sms",
            variables: {
              visitorName: request.visitorName,
              reason: "Host did not respond within 24 hours",
            },
          }),
        });
      }

      if (request.visitorEmail) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.visitRequestAutoRejected,
            recipient: request.visitorEmail,
            channel: "email",
            variables: {
              visitorName: request.visitorName,
              reason: "Host did not respond within 24 hours",
            },
          }),
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "visit_request", resourceId: p.id, outcome: "success" } });
      }
    });
  });

  // ─── workflowTaskCompleted (Requirement 3.6, 11.2, 20.5) ────────────
  // Consumed from workflow-service: when all approval levels for a
  // restricted-area visit are marked complete, transition to approved
  // and trigger pass generation.
  queue.subscribe<WorkflowTaskCompletedPayload>(CONSUMED_EVENTS.workflowTaskCompleted, async (msg) => {
    const p = msg.payload;

    // Only handle approval decisions for visit request workflows
    if (p.decision !== "approve" || !p.refId) return;

    const visitRequestId = p.refId;

    const result = await db.transaction(async (tx): Promise<{
      approved: boolean;
      visitRequest: {
        locationId: string;
        visitorName: string;
        visitorPhone: string;
        visitorEmail: string | null;
        hostEmployeeId: string;
        passType: string;
        permittedAreas: string[];
        scheduledAt: Date | null;
      } | null;
    }> => {
      if (!(await markProcessed(tx, msg.messageId))) {
        return { approved: false, visitRequest: null }; // idempotent replay
      }

      const rows = await tx
        .select()
        .from(visitRequests)
        .where(and(eq(visitRequests.id, visitRequestId), eq(visitRequests.tenantId, msg.tenantId)))
        .limit(1);
      const request = rows[0];
      if (!request) {
        log.warn(
          { tenantId: msg.tenantId, visitRequestId, instanceId: p.instanceId, event: "workflow_task_completed_not_found" },
          "visit request not found for workflow task completion",
        );
        return { approved: false, visitRequest: null };
      }

      // Only transition if still pending approval (idempotency guard)
      if (request.status !== "pending_approval") {
        log.info(
          { tenantId: msg.tenantId, visitRequestId, status: request.status, event: "workflow_task_completed_skipped" },
          "visit request already transitioned, skipping workflow task completion",
        );
        return { approved: false, visitRequest: null };
      }

      // Transition to approved
      await versionedUpdate(tx, visitRequests, {
        id: visitRequestId,
        tenantId: msg.tenantId,
        expectedVersion: request.version,
        set: {
          status: "approved",
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "visit_request",
      });

      // Outbox: visitRequestApproved event
      await enqueue(tx, {
        topic: EVENTS.visitRequestApproved,
        eventType: EVENTS.visitRequestApproved,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: visitRequestId,
          tenantId: msg.tenantId,
          locationId: request.locationId,
          hostEmployeeId: request.hostEmployeeId,
          visitorName: request.visitorName,
          status: "approved",
          approvalSource: "workflow",
          instanceId: p.instanceId,
        },
      });

      // Notify visitor of approval via SMS + email
      if (request.visitorPhone) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.visitRequestApproved,
            recipient: request.visitorPhone,
            channel: "sms",
            variables: {
              visitorName: request.visitorName,
              hostEmployeeId: request.hostEmployeeId,
              scheduledAt: request.scheduledAt?.toISOString() ?? "",
            },
          }),
        });
      }

      if (request.visitorEmail) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.visitRequestApproved,
            recipient: request.visitorEmail,
            channel: "email",
            variables: {
              visitorName: request.visitorName,
              hostEmployeeId: request.hostEmployeeId,
              scheduledAt: request.scheduledAt?.toISOString() ?? "",
            },
          }),
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "visit_request", resourceId: msg.messageId, outcome: "success" } });
      }

      const permittedAreaIds = (request.permittedAreas ?? []) as string[];
      return {
        approved: true,
        visitRequest: {
          locationId: request.locationId,
          visitorName: request.visitorName,
          visitorPhone: request.visitorPhone,
          visitorEmail: request.visitorEmail ?? null,
          hostEmployeeId: request.hostEmployeeId,
          passType: request.passType,
          permittedAreas: permittedAreaIds,
          scheduledAt: request.scheduledAt,
        },
      };
    });

    if (!result.approved || !result.visitRequest) return;

    // Post-commit: trigger visitor.pass.generate command
    try {
      await queueSingleton.publish(COMMANDS.passGenerate, {
        messageId: `${visitRequestId}:pass-gen`,
        type: COMMANDS.passGenerate,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        schemaVersion: "1.0",
        payload: {
          visitRequestId,
          tenantId: msg.tenantId,
          locationId: result.visitRequest.locationId,
          visitorName: result.visitRequest.visitorName,
          visitorPhone: result.visitRequest.visitorPhone,
          visitorEmail: result.visitRequest.visitorEmail,
          hostEmployeeId: result.visitRequest.hostEmployeeId,
          passType: result.visitRequest.passType,
          permittedAreas: result.visitRequest.permittedAreas,
          scheduledAt: result.visitRequest.scheduledAt?.toISOString() ?? "",
        },
      });
    } catch (err) {
      log.warn(
        { err, tenantId: msg.tenantId, visitRequestId, event: "pass_generate_publish_failed" },
        "failed to publish pass.generate after workflow approval; visit request is approved but pass generation may be delayed",
      );
    }
  });

  // ─── workflowInstanceRejected (Requirement 3.6, 11.2, 20.5) ─────────
  // Consumed from workflow-service: when a restricted-area approval workflow
  // is rejected at any level, transition the visit request to rejected and
  // notify the visitor.
  queue.subscribe<WorkflowInstanceRejectedPayload>(CONSUMED_EVENTS.workflowInstanceRejected, async (msg) => {
    const p = msg.payload;

    // Only handle rejections that reference a visit request
    if (!p.refId) return;

    const visitRequestId = p.refId;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      const rows = await tx
        .select()
        .from(visitRequests)
        .where(and(eq(visitRequests.id, visitRequestId), eq(visitRequests.tenantId, msg.tenantId)))
        .limit(1);
      const request = rows[0];
      if (!request) {
        log.warn(
          { tenantId: msg.tenantId, visitRequestId, instanceId: p.instanceId, event: "workflow_instance_rejected_not_found" },
          "visit request not found for workflow instance rejection",
        );
        return;
      }

      // Only transition if still pending approval (idempotency guard)
      if (request.status !== "pending_approval") {
        log.info(
          { tenantId: msg.tenantId, visitRequestId, status: request.status, event: "workflow_instance_rejected_skipped" },
          "visit request already transitioned, skipping workflow rejection",
        );
        return;
      }

      const rejectionReason = p.reason ?? "Approval workflow rejected";

      // Transition to rejected
      await versionedUpdate(tx, visitRequests, {
        id: visitRequestId,
        tenantId: msg.tenantId,
        expectedVersion: request.version,
        set: {
          status: "rejected",
          rejectionReason,
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "visit_request",
      });

      // Outbox: visitRequestRejected event
      await enqueue(tx, {
        topic: EVENTS.visitRequestRejected,
        eventType: EVENTS.visitRequestRejected,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: visitRequestId,
          tenantId: msg.tenantId,
          hostEmployeeId: request.hostEmployeeId,
          visitorName: request.visitorName,
          status: "rejected",
          rejectionReason,
          rejectionSource: "workflow",
          instanceId: p.instanceId,
        },
      });

      // Notify visitor of rejection via SMS + email
      if (request.visitorPhone) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.visitRequestRejected,
            recipient: request.visitorPhone,
            channel: "sms",
            variables: {
              visitorName: request.visitorName,
              reason: rejectionReason,
            },
          }),
        });
      }

      if (request.visitorEmail) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.visitRequestRejected,
            recipient: request.visitorEmail,
            channel: "email",
            variables: {
              visitorName: request.visitorName,
              reason: rejectionReason,
            },
          }),
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "visit_request", resourceId: msg.messageId, outcome: "success" } });
      }
    });
  });
}
