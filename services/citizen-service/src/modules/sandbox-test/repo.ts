import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { sandboxTestRuns, type SandboxTestRunInsert, type SandboxTestRunRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "select">;

export async function insertRun(tx: Writer, row: SandboxTestRunInsert): Promise<SandboxTestRunRow> {
  const rows = await tx.insert(sandboxTestRuns).values(row).returning();
  return rows[0]!;
}

export async function listRunsForDefinition(
  tenantId: string,
  serviceDefinitionId: string,
  limit = 10,
): Promise<SandboxTestRunRow[]> {
  return db.transaction((tx) =>
    tx.select().from(sandboxTestRuns)
      .where(and(
        eq(sandboxTestRuns.tenantId, tenantId),
        eq(sandboxTestRuns.serviceDefinitionId, serviceDefinitionId),
      ))
      .orderBy(desc(sandboxTestRuns.createdAt))
      .limit(limit),
  );
}

export async function latestRunForDefinition(
  tenantId: string,
  serviceDefinitionId: string,
): Promise<SandboxTestRunRow | null> {
  const rows = await listRunsForDefinition(tenantId, serviceDefinitionId, 1);
  return rows[0] ?? null;
}

export async function latestPassedRunForDefinition(
  tenantId: string,
  serviceDefinitionId: string,
): Promise<SandboxTestRunRow | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(sandboxTestRuns)
      .where(and(
        eq(sandboxTestRuns.tenantId, tenantId),
        eq(sandboxTestRuns.serviceDefinitionId, serviceDefinitionId),
        eq(sandboxTestRuns.status, "pass"),
      ))
      .orderBy(desc(sandboxTestRuns.createdAt))
      .limit(1);
    return rows[0] ?? null;
  });
}
