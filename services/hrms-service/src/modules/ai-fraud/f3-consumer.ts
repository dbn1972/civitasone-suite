// @ts-nocheck — RETAINED DELIBERATELY. Cases ai_fraud_routes__0 and __1 below
// reference `alert` / `rec`, which cannot be reconstructed inside this consumer
// (see the TODO(unresolved-f3-bug) notes on each). The remaining case is clean;
// once routes.ts forwards the alert/recommendation in the F3 payload, drop this
// banner and the file should typecheck.
import { randomUUID } from "node:crypto";
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
            // TODO(unresolved-f3-bug): `alert` is undefined and CANNOT be
            // recovered here. In routes.ts, POST /v1/hrms/ai/scan builds an
            // in-memory `alerts[]` from the detection engine and then loops
            // `for (const alert of alerts) await publishF3Write(..., "ai_fraud_routes__0", randomUUID(), {body, params, query})`.
            // The alert object itself is never put in the payload, and the N
            // published messages are byte-identical apart from their message id
            // — there is no index or discriminator to tell this consumer WHICH
            // alert it is meant to persist. Re-running the whole scan here is not
            // a fix either: each of the N messages would then insert all N alerts.
            // Left throwing (loud) rather than silently no-op'ing, so the failure
            // stays visible in the DLQ/logs instead of quietly dropping fraud
            // alerts. Real fix (needs a routes.ts change, out of scope for this
            // batch): pass the alert in the payload, e.g.
            //   publishF3Write(ctx, "ai_fraud_routes__0", randomUUID(), { alert, body, params, query })
            // then read it here as `const alert = p.alert`.
            await tx.insert(hrmsFraudAlerts).values({
                    id: randomUUID(), tenantId: p.tenantId, alertType: alert.alertType, severity: alert.severity,
                    employeeId: alert.employeeId, description: alert.description, evidence: alert.evidence,
                    riskScore: String(alert.riskScore), mlModel: alert.mlModel, status: "open",
                  } as any);
            break;
          }
          case "ai_fraud_routes__1": {
            // TODO(unresolved-f3-bug): `rec` is undefined and cannot be recovered
            // here, for exactly the same reason as __0 — GET /v1/hrms/ai/recommendations
            // loops over engine.generateRecommendations(...) and publishes one
            // payload-identical message per recommendation without including the
            // recommendation itself. Same fix: forward `rec` in the payload.
            await tx.insert(hrmsRecommendations).values({
                      id: randomUUID(), tenantId: p.tenantId, employeeId: rec.employeeId ?? null,
                      category: rec.category, title: rec.title, description: rec.description, priority: rec.priority,
                    } as any);
            break;
          }
          case "ai_fraud_routes__2": {
            // PATCH /v1/hrms/ai/alerts/:id publishes a FRESH randomUUID() as the
            // envelope id, so the generated `id` above is a brand-new identifier
            // and this UPDATE matched zero rows every time — the route answered
            // 200 with the new status while the alert never changed. The alert to
            // update is the :id path param.
            const alertId = String(params.id ?? "");
            await tx.update(hrmsFraudAlerts).set({ status: body.status, resolutionNotes: body.resolutionNotes ?? null, resolvedBy: body.status === "resolved" ? msg.actorId : null, resolvedAt: body.status === "resolved" ? new Date() : null, updatedAt: new Date() } as any)
                  .where(and(eq(hrmsFraudAlerts.id, alertId), eq(hrmsFraudAlerts.tenantId, p.tenantId)));
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
