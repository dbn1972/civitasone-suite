import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { secIncidents, secBreachNotifications } from "./schema.js";
import {
  canTransition,
  checkCloseSegregation,
  computeBreachDeadline,
  DPDP_BREACH_WINDOW_HOURS,
  eventTopicForStatus,
  timestampColumnFor,
  type IncidentStatus,
} from "./service.js";

const log = pino({ name: "admin-security-incident-consumer" });
const AUDIT = "audit.event.record";

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
) {
  await enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: "admin",
      action,
      resourceType: "security_incident",
      resourceId,
      outcome: "success",
    },
  });
}

export function registerSecurityIncidentConsumers(q: Queue): void {
  q.subscribe<{
    id: string;
    tenantId: string;
    title: string;
    severity: string;
    category: string;
    description?: string;
    affectedAssets: string[];
    affectedTenants: string[];
    isBreach: boolean;
    affectedDataPrincipals: number;
  }>(COMMANDS.securityIncidentCreate, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await tx.insert(secIncidents).values({
          id: p.id,
          tenantId: p.tenantId,
          title: p.title,
          severity: p.severity,
          category: p.category,
          description: p.description ?? null,
          affectedAssets: p.affectedAssets,
          affectedTenants: p.affectedTenants,
          isBreach: p.isBreach,
          affectedDataPrincipals: p.affectedDataPrincipals,
          status: "detected",
          reportedBy: msg.actorId,
        });
        await repo.appendTimeline(tx, {
          tenantId: p.tenantId,
          incidentId: p.id,
          actorId: msg.actorId,
          fromStatus: null,
          toStatus: "detected",
          note: "incident detected",
        });
        await enqueue(tx, {
          topic: "security.incident.detected",
          eventType: "security.incident.detected",
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            id: p.id,
            tenantId: p.tenantId,
            severity: p.severity,
            isBreach: p.isBreach,
            title: p.title,
          },
        });
        await audit(tx, msg, "create_security_incident", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "securityIncidentCreate failed");
      throw err;
    }
  });

  q.subscribe<{
    id: string;
    tenantId: string;
    toStatus: "triaged" | "contained" | "resolved";
    note?: string;
    rootCause?: string;
    resolution?: string;
  }>(COMMANDS.securityIncidentTransition, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const inc = await repo.findIncidentTx(tx, p.tenantId, p.id);
        if (!inc) {
          log.warn({ id: p.id }, "incident missing for transition");
          return;
        }
        const from = inc.status as IncidentStatus;
        const to = p.toStatus as IncidentStatus;
        if (!canTransition(from, to)) {
          log.warn({ from, to, id: p.id }, "invalid transition ignored");
          return;
        }
        const col = timestampColumnFor(to);
        const patch: Record<string, unknown> = {
          status: to,
          updatedAt: new Date(),
          version: inc.version + 1,
        };
        if (col) patch[col] = new Date();
        if (p.rootCause) patch.rootCause = p.rootCause;
        if (p.resolution) patch.resolution = p.resolution;
        await tx
          .update(secIncidents)
          .set(patch)
          .where(and(eq(secIncidents.tenantId, p.tenantId), eq(secIncidents.id, p.id)));
        await repo.appendTimeline(tx, {
          tenantId: p.tenantId,
          incidentId: p.id,
          actorId: msg.actorId,
          fromStatus: from,
          toStatus: to,
          note: p.note ?? null,
        });
        await enqueue(tx, {
          topic: eventTopicForStatus(to),
          eventType: eventTopicForStatus(to),
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { id: p.id, tenantId: p.tenantId, from, to, severity: inc.severity },
        });
        await audit(tx, msg, `incident_${to}`, p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "securityIncidentTransition failed");
      throw err;
    }
  });

  q.subscribe<{ id: string; tenantId: string; note?: string }>(COMMANDS.securityIncidentClose, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const inc = await repo.findIncidentTx(tx, p.tenantId, p.id);
        if (!inc) return;
        if (!canTransition(inc.status as IncidentStatus, "closed")) return;
        const segErr = checkCloseSegregation(inc.reportedBy, msg.actorId);
        if (segErr) {
          log.warn({ id: p.id, segErr }, "maker-checker close rejected in consumer");
          return;
        }
        await tx
          .update(secIncidents)
          .set({
            status: "closed",
            closedAt: new Date(),
            closedBy: msg.actorId,
            updatedAt: new Date(),
            version: inc.version + 1,
          })
          .where(and(eq(secIncidents.tenantId, p.tenantId), eq(secIncidents.id, p.id)));
        await repo.appendTimeline(tx, {
          tenantId: p.tenantId,
          incidentId: p.id,
          actorId: msg.actorId,
          fromStatus: inc.status,
          toStatus: "closed",
          note: p.note ?? null,
        });
        await enqueue(tx, {
          topic: "security.incident.closed",
          eventType: "security.incident.closed",
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { id: p.id, tenantId: p.tenantId, closedBy: msg.actorId },
        });
        await audit(tx, msg, "incident_closed", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "securityIncidentClose failed");
      throw err;
    }
  });

  q.subscribe<{
    id: string;
    incidentId: string;
    tenantId: string;
    authority: "data_protection_board" | "data_principals";
    affectedCount: number;
  }>(COMMANDS.securityBreachNotificationCreate, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const inc = await repo.findIncidentTx(tx, p.tenantId, p.incidentId);
        if (!inc) return;
        const deadline = computeBreachDeadline(new Date(inc.detectedAt), DPDP_BREACH_WINDOW_HOURS);
        await tx.insert(secBreachNotifications).values({
          id: p.id,
          tenantId: p.tenantId,
          incidentId: p.incidentId,
          authority: p.authority,
          status: "pending",
          windowHours: DPDP_BREACH_WINDOW_HOURS,
          deadlineAt: deadline,
          affectedCount: p.affectedCount,
          createdBy: msg.actorId,
        });
        if (!inc.isBreach) {
          await tx
            .update(secIncidents)
            .set({ isBreach: true, updatedAt: new Date() })
            .where(and(eq(secIncidents.tenantId, p.tenantId), eq(secIncidents.id, p.incidentId)));
        }
        await enqueue(tx, {
          topic: "security.breach.notification_due",
          eventType: "security.breach.notification_due",
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            id: p.id,
            incidentId: p.incidentId,
            authority: p.authority,
            deadlineAt: deadline.toISOString(),
            affectedCount: p.affectedCount,
          },
        });
        await audit(tx, msg, "breach_notification_created", p.incidentId);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "securityBreachNotificationCreate failed");
      throw err;
    }
  });

  q.subscribe<{ id: string; incidentId: string; tenantId: string; reference: string }>(
    COMMANDS.securityBreachNotificationSubmit,
    async (msg) => {
      try {
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          const p = msg.payload;
          const notif = await repo.findBreachTx(tx, p.tenantId, p.incidentId, p.id);
          if (!notif || notif.status !== "pending") return;
          const now = new Date();
          const onTime = now.getTime() <= new Date(notif.deadlineAt).getTime();
          await tx
            .update(secBreachNotifications)
            .set({ status: "submitted", submittedAt: now, reference: p.reference })
            .where(and(eq(secBreachNotifications.tenantId, p.tenantId), eq(secBreachNotifications.id, p.id)));
          await enqueue(tx, {
            topic: "security.breach.notification_submitted",
            eventType: "security.breach.notification_submitted",
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              id: p.id,
              incidentId: p.incidentId,
              authority: notif.authority,
              onTime,
              reference: p.reference,
            },
          });
          await audit(tx, msg, "breach_notification_submitted", p.incidentId);
        });
      } catch (err) {
        log.error({ err, messageId: msg.messageId }, "securityBreachNotificationSubmit failed");
        throw err;
      }
    },
  );
}
