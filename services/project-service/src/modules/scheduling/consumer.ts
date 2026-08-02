import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { hasCycle, MAX_DEPS_PER_TASK } from "./domain.js";
import * as repo from "./repo.js";
import { countBaselines, insertBaseline, MAX_BASELINES_PER_PROJECT } from "./baselines.js";

const log = pino({ name: "project.scheduling.consumer" });
const AUDIT = "audit.event.record";

export function registerSchedulingConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.dependencyCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; projectId: string;
      fromTaskId: string; toTaskId: string; depType: string; lagMs: string | number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const txDb = tx as typeof db;
      if (p.fromTaskId === p.toTaskId) return;
      const currentCount = await repo.countDepsForTask(txDb, p.projectId, p.tenantId, p.toTaskId);
      if (currentCount >= MAX_DEPS_PER_TASK) return;
      const existingDeps = await repo.getProjectDeps(txDb, p.projectId, p.tenantId);
      const cyclePath = hasCycle([...existingDeps, { fromTaskId: p.fromTaskId, toTaskId: p.toTaskId }]);
      if (cyclePath) return;
      await repo.insertDependency(txDb, {
        id: p.id,
        tenantId: p.tenantId,
        projectId: p.projectId,
        fromTaskId: p.fromTaskId,
        toTaskId: p.toTaskId,
        depType: p.depType as never,
        lagMs: BigInt(p.lagMs),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "project", action: "dependency_create",
          resourceType: "task_dependency", resourceId: p.id, outcome: "success",
        },
      });
    });
    log.info({ id: p.id }, "dependency created");
  });

  queue.subscribe(COMMANDS.dependencyDelete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; projectId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.deleteDependency(tx as typeof db, p.id, p.projectId, p.tenantId);
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "project", action: "dependency_delete",
          resourceType: "task_dependency", resourceId: p.id, outcome: "success",
        },
      });
    });
  });

  queue.subscribe(COMMANDS.baselineCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; projectId: string; label: string; snapshotData: unknown;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const currentCount = await countBaselines(tx as typeof db, p.projectId, p.tenantId);
      if (currentCount >= MAX_BASELINES_PER_PROJECT) return;
      await insertBaseline(tx as typeof db, {
        id: p.id,
        tenantId: p.tenantId,
        projectId: p.projectId,
        label: p.label,
        snapshotData: p.snapshotData,
        createdBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "project", action: "baseline_create",
          resourceType: "project_baseline", resourceId: p.id, outcome: "success",
        },
      });
    });
  });
}
