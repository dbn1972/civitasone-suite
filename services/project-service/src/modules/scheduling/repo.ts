import { eq, and, count, or } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { taskDependencies } from "./schema.js";
import type { TaskDep } from "./domain.js";

type DbLike = typeof db;

/**
 * Fetch all dependencies for a project (used for cycle detection).
 * Uses the provided db/tx instance for RLS-scoped queries.
 */
export async function getProjectDeps(dbOrTx: DbLike, projectId: string, tenantId: string): Promise<TaskDep[]> {
  const rows = await dbOrTx
    .select({ fromTaskId: taskDependencies.fromTaskId, toTaskId: taskDependencies.toTaskId })
    .from(taskDependencies)
    .where(and(eq(taskDependencies.projectId, projectId), eq(taskDependencies.tenantId, tenantId)));
  return rows;
}

/**
 * Count existing dependencies for a given task (as toTaskId) within a project.
 */
export async function countDepsForTask(dbOrTx: DbLike, projectId: string, tenantId: string, toTaskId: string): Promise<number> {
  const [result] = await dbOrTx
    .select({ cnt: count() })
    .from(taskDependencies)
    .where(
      and(
        eq(taskDependencies.projectId, projectId),
        eq(taskDependencies.tenantId, tenantId),
        eq(taskDependencies.toTaskId, toTaskId),
      ),
    );
  return result?.cnt ?? 0;
}

/**
 * List dependencies for a project with pagination.
 * Uses the global db (reads are fine without GUC — RLS just filters).
 */
export async function listDependencies(projectId: string, tenantId: string, page: number, limit: number) {
  const offset = (page - 1) * limit;
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before these reads — bare db.select() calls run with no RLS GUC set.
  const [rows, totalResult] = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(taskDependencies)
      .where(and(eq(taskDependencies.projectId, projectId), eq(taskDependencies.tenantId, tenantId)))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await tx
      .select({ cnt: count() })
      .from(taskDependencies)
      .where(and(eq(taskDependencies.projectId, projectId), eq(taskDependencies.tenantId, tenantId)));

    return [rows, totalResult] as const;
  });

  return {
    data: rows,
    meta: { page, pageSize: limit, total: totalResult?.cnt ?? 0 },
  };
}

/**
 * Insert a new dependency record within a transaction.
 */
export async function insertDependency(dbOrTx: DbLike, input: {
  id: string;
  tenantId: string;
  projectId: string;
  fromTaskId: string;
  toTaskId: string;
  depType: string;
  lagMs: bigint;
  createdBy: string;
  updatedBy: string;
}) {
  const [row] = await dbOrTx.insert(taskDependencies).values(input).returning();
  return row;
}

/**
 * Delete a dependency by ID within a transaction.
 */
export async function deleteDependency(dbOrTx: DbLike, id: string, projectId: string, tenantId: string): Promise<boolean> {
  const result = await dbOrTx
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.id, id),
        eq(taskDependencies.projectId, projectId),
        eq(taskDependencies.tenantId, tenantId),
      ),
    )
    .returning();
  return result.length > 0;
}
