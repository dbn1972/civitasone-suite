import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsFraudAlerts, hrmsEmployeeRiskScores, hrmsRecommendations } from "./schema.js";
import * as engine from "./detection-engine.js";
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
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "ai_fraud_routes__0": {
            await tx.insert(hrmsFraudAlerts).values({
                    id: randomUUID(), tenantId: p.tenantId, alertType: alert.alertType, severity: alert.severity,
                    employeeId: alert.employeeId, description: alert.description, evidence: alert.evidence,
                    riskScore: String(alert.riskScore), mlModel: alert.mlModel, status: "open",
                  } as any);
            break;
          }
          case "ai_fraud_routes__1": {
            await tx.insert(hrmsRecommendations).values({
                      id: randomUUID(), tenantId: p.tenantId, employeeId: rec.employeeId ?? null,
                      category: rec.category, title: rec.title, description: rec.description, priority: rec.priority,
                    } as any);
            break;
          }
          case "ai_fraud_routes__2": {
            await tx.update(hrmsFraudAlerts).set({ status: body.status, resolutionNotes: body.resolutionNotes ?? null, resolvedBy: body.status === "resolved" ? msg.actorId : null, resolvedAt: body.status === "resolved" ? new Date() : null, updatedAt: new Date() } as any)
                  .where(and(eq(hrmsFraudAlerts.id, id), eq(hrmsFraudAlerts.tenantId, p.tenantId)));
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
