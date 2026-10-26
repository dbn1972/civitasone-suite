import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsFraudAlerts, hrmsRecommendations } from "./schema.js";
import type { FraudAlert, Recommendation } from "./detection-engine.js";
const log = pino({ name: "hrms-f3-ai-fraud" });
export function registerF3_ai_fraud_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "ai_fraud_routes__0",
      "ai_fraud_routes__1",
      "ai_fraud_routes__2",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const tenantId = String(p.tenantId ?? msg.tenantId);
    try {
      // FORCE-RLS tables: pin app.tenant_id for the whole transaction (the
      // production queue consumer has no ambient tenant context of its own).
      await runWithTenant(tenantId, () => db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "ai_fraud_routes__0": {
            // POST /v1/hrms/ai/scan forwards ONE engine alert per command.
            const alert = p.alert as FraudAlert | undefined;
            if (!alert) throw new Error("ai_fraud_routes__0: payload.alert missing");
            const id = randomUUID();
            await tx.insert(hrmsFraudAlerts).values({
              id, tenantId, alertType: alert.alertType, severity: alert.severity,
              employeeId: alert.employeeId ?? null, description: alert.description, evidence: alert.evidence ?? {},
              riskScore: String(alert.riskScore), mlModel: alert.mlModel ?? null, status: "open",
            });
            await enqueue(tx, {
              topic: "audit.event.record", eventType: "audit.event.record",
              tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                service: "hrms", action: "create", resourceType: "fraud_alert", resourceId: id, outcome: "success",
                metadata: { alertType: alert.alertType, severity: alert.severity, employeeId: alert.employeeId ?? null },
              },
            });
            break;
          }
          case "ai_fraud_routes__1": {
            // GET /v1/hrms/ai/recommendations forwards ONE generated rec per command.
            const rec = p.rec as Recommendation | undefined;
            if (!rec) throw new Error("ai_fraud_routes__1: payload.rec missing");
            const id = randomUUID();
            await tx.insert(hrmsRecommendations).values({
              id, tenantId, employeeId: rec.employeeId ?? null,
              category: rec.category, title: rec.title, description: rec.description, priority: rec.priority,
            });
            await enqueue(tx, {
              topic: "audit.event.record", eventType: "audit.event.record",
              tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                service: "hrms", action: "create", resourceType: "ai_recommendation", resourceId: id, outcome: "success",
                metadata: { category: rec.category, priority: rec.priority, employeeId: rec.employeeId ?? null },
              },
            });
            break;
          }
          case "ai_fraud_routes__2": {
            // PATCH /v1/hrms/ai/alerts/:id publishes a FRESH randomUUID() as the
            // envelope id, so the generated `id` above is a brand-new identifier
            // and this UPDATE matched zero rows every time — the route answered
            // 200 with the new status while the alert never changed. The alert to
            // update is the :id path param.
            const alertId = String(params.id ?? "");
            await tx.update(hrmsFraudAlerts).set({ status: body.status, resolutionNotes: body.resolutionNotes ?? null, resolvedBy: body.status === "resolved" ? msg.actorId : null, resolvedAt: body.status === "resolved" ? new Date() : null, updatedAt: new Date() })
              .where(and(eq(hrmsFraudAlerts.id, alertId), eq(hrmsFraudAlerts.tenantId, tenantId)));
            break;
          }
        }
      }));
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
