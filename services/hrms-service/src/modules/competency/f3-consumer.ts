// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { analyzeGaps, mergeLevel } from "./domain.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-competency" });
export function registerF3_competency_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "competency_routes__0",
      "competency_routes__1",
      "competency_routes__2",
      "competency_routes__3",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "competency_routes__0": {
            await repo.insertFramework(tx, {
                  id, tenantId: p.tenantId, name: body.name, description: body.description ?? null, createdBy: msg.actorId,
                });
            break;
          }
          case "competency_routes__1": {
            await repo.insertCompetency(tx, {
                  id: cid, tenantId: p.tenantId, frameworkId: id, code: body.code, name: body.name,
                  description: body.description ?? null, category: body.category,
                  maxLevel: body.maxLevel, certifiedLevel: body.certifiedLevel,
                });
            break;
          }
          case "competency_routes__2": {
            await repo.upsertRoleRequirement(tx, {
                  id: randomUUID(), tenantId: p.tenantId, roleCode: body.roleCode,
                  competencyId: body.competencyId, requiredLevel: body.requiredLevel,
                });
            break;
          }
          case "competency_routes__3": {
            await repo.upsertEmployeeCompetency(tx, {
                  tenantId: p.tenantId, employeeId: id, competencyId: body.competencyId,
                  currentLevel: level, source: body.source, evidenceRef: body.evidenceRef ?? null,
                });
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
