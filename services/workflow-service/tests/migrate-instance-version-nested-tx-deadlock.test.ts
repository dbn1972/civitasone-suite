/**
 * workflow-service migrateInstanceVersion nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: migrateInstanceVersion (instances/commands.ts) opens
 * db.transaction() and, from inside it, called defRepo.findById /
 * defRepo.listNodes / defRepo.listEdges -- scopedRead-based functions in
 * definitions/repo.ts that each open their own db.transaction() -- from
 * INSIDE the already-open outer transaction. A bulk definition-version
 * rollout migrating many in-flight instances at once is a realistic trigger.
 *
 * Fixed by routing onto findByIdTx / listNodesTx / listEdgesTx, reading
 * through the already-open transaction passed in by the caller.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { migrateInstanceVersion } from "../src/modules/instances/commands.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, seedDefinition, cleanup, asTenant, sqlAsTenant } from "./helpers/engine-harness.js";
import type { RequestContext } from "@civitasone/types";

const CONCURRENCY = 13; // pool.max (10) + 3

function makeCtx(tenantId: string, actorId: string): RequestContext {
  return { tenantId, actorId, roles: ["workflow_admin", "super_admin"], correlationId: randomUUID(), sessionId: "s1" } as RequestContext;
}

afterAll(async () => { await sqlClient.end(); });

describe("workflow-service migrateInstanceVersion -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent migrateInstanceVersion calls (each its own tenant/definition/instance) drain without deadlocking the connection pool",
    async () => {
      const tenants: string[] = [];
      const jobs: Array<{ tenantId: string; actorId: string; instanceId: string }> = [];

      const q = new TestQueue();
      registerInstancesConsumers(q);
      registerTasksConsumers(q);

      for (let i = 0; i < CONCURRENCY; i++) {
        const tenantId = randomUUID();
        tenants.push(tenantId);
        const actorId = randomUUID();
        const code = "migrate_deadlock_" + randomUUID().slice(0, 8);

        const def1 = await seedDefinition(tenantId, [
          { nodeKey: "start", name: "Start", nodeType: "start", sortOrder: 1 },
          { nodeKey: "end", name: "End", nodeType: "end", sortOrder: 2 },
        ], [
          { fromNode: "start", toNode: "end", sortOrder: 1 },
        ], { code });

        // Create the instance while v1 is the ONLY active version of this
        // code, so createInstance unambiguously binds to it -- inserting v2
        // as also 'active' before this point makes the createInstance
        // definition lookup (no explicit ordering) nondeterministically pick
        // either version, occasionally binding the instance to v2 already
        // and making the migrate-to-2 call below spuriously fail with
        // SAME_VERSION instead of exercising the deadlock path.
        const instanceId = randomUUID();
        await q.deliver(COMMANDS.createInstance, {
          id: instanceId, tenantId, name: "deadlock test", status: "active", version: 1,
          initialTaskName: "Start", definitionCode: def1.code,
        }, { tenantId, actorId, messageId: instanceId });

        const def2Id = randomUUID();
        await sqlAsTenant(tenantId, sql`
          INSERT INTO workflow.definitions (id, tenant_id, code, name, version, status, created_by, updated_by)
          VALUES (${def2Id}, ${tenantId}, ${code}, ${code + " v2"}, 2, 'active', ${actorId}, ${actorId})
        `);
        await sqlAsTenant(tenantId, sql`
          INSERT INTO workflow.definition_nodes (definition_id, node_key, name, node_type, sort_order)
          VALUES (${def2Id}, 'start', 'Start v2', 'start', 1), (${def2Id}, 'end', 'End v2', 'end', 2)
        
        `);
        await sqlAsTenant(tenantId, sql`
          INSERT INTO workflow.definition_edges (definition_id, from_node, to_node, sort_order)
          VALUES (${def2Id}, 'start', 'end', 1)
        `);

        jobs.push({ tenantId, actorId, instanceId });
      }

      const DRAIN_TIMEOUT_MS = 10000;
      let timedOut = false;
      const race = Promise.race([
        Promise.all(jobs.map((j) =>
          asTenant(j.tenantId, () => migrateInstanceVersion(makeCtx(j.tenantId, j.actorId), j.instanceId, 2)),
        )),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);
      await race;

      expect(timedOut, "concurrent migrations did not complete within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);

      await cleanup(...tenants);
    },
    { timeout: 20000 },
  );
});
