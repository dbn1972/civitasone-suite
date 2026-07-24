import { and, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  frameworks, competencies, roleRequirements, employeeCompetencies,
  type CompetencyRow, type RoleRequirementRow, type EmployeeCompetencyRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── frameworks ────────────────────────────────────────────────────
export async function insertFramework(tx: Writer, row: typeof frameworks.$inferInsert): Promise<void> {
  await tx.insert(frameworks).values(row);
}
export async function listFrameworks(tenantId: string) {
  return scopedRead((t) => t.select().from(frameworks).where(eq(frameworks.tenantId, tenantId)));
}
export async function getFramework(tenantId: string, id: string) {
  const rows = await scopedRead((t) => t.select().from(frameworks)
    .where(and(eq(frameworks.id, id), eq(frameworks.tenantId, tenantId))).limit(1));
  return rows[0];
}

// ── competency dictionary ─────────────────────────────────────────
export async function insertCompetency(tx: Writer, row: typeof competencies.$inferInsert): Promise<CompetencyRow> {
  const rows = await tx.insert(competencies).values(row).returning();
  return rows[0]!;
}
export async function listCompetencies(tenantId: string): Promise<CompetencyRow[]> {
  return scopedRead((t) => t.select().from(competencies).where(eq(competencies.tenantId, tenantId)));
}
export async function getCompetency(tenantId: string, id: string): Promise<CompetencyRow | undefined> {
  const rows = await scopedRead((t) => t.select().from(competencies)
    .where(and(eq(competencies.id, id), eq(competencies.tenantId, tenantId))).limit(1));
  return rows[0];
}
export async function getCompetencyByCode(tenantId: string, code: string): Promise<CompetencyRow | undefined> {
  const rows = await scopedRead((t) => t.select().from(competencies)
    .where(and(eq(competencies.code, code), eq(competencies.tenantId, tenantId))).limit(1));
  return rows[0];
}
/** Tx-scoped lookup by code (used inside the consumer transaction). */
export async function getCompetencyByCodeTx(tx: Writer, tenantId: string, code: string): Promise<CompetencyRow | undefined> {
  const rows = await tx.select().from(competencies)
    .where(and(eq(competencies.code, code), eq(competencies.tenantId, tenantId))).limit(1);
  return rows[0];
}

// ── role requirements ─────────────────────────────────────────────
export async function upsertRoleRequirement(tx: Writer, row: typeof roleRequirements.$inferInsert): Promise<void> {
  await tx.insert(roleRequirements).values(row)
    .onConflictDoUpdate({
      target: [roleRequirements.tenantId, roleRequirements.roleCode, roleRequirements.competencyId],
      set: { requiredLevel: row.requiredLevel ?? 1 },
    });
}
export async function listRoleRequirements(tenantId: string, roleCode: string): Promise<RoleRequirementRow[]> {
  return scopedRead((t) => t.select().from(roleRequirements)
    .where(and(eq(roleRequirements.tenantId, tenantId), eq(roleRequirements.roleCode, roleCode))));
}

// ── employee competency profile ───────────────────────────────────
export async function listEmployeeCompetencies(tenantId: string, employeeId: string): Promise<EmployeeCompetencyRow[]> {
  return scopedRead((t) => t.select().from(employeeCompetencies)
    .where(and(eq(employeeCompetencies.tenantId, tenantId), eq(employeeCompetencies.employeeId, employeeId))));
}
/**
 * Upsert a held competency to at least `level` (never regressing a higher held
 * level — handled by the GREATEST expression). Used by manual edits and the
 * certificate consumer.
 */
export async function upsertEmployeeCompetency(
  tx: Writer,
  row: { tenantId: string; employeeId: string; competencyId: string; currentLevel: number; source: string; evidenceRef: string | null },
): Promise<void> {
  await tx.insert(employeeCompetencies).values({
    tenantId: row.tenantId, employeeId: row.employeeId, competencyId: row.competencyId,
    currentLevel: row.currentLevel, source: row.source, evidenceRef: row.evidenceRef, updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [employeeCompetencies.tenantId, employeeCompetencies.employeeId, employeeCompetencies.competencyId],
    set: {
      // GREATEST(existing, incoming) so new evidence never lowers a held level.
      currentLevel: sql`GREATEST(${employeeCompetencies.currentLevel}, ${row.currentLevel})`,
      source: row.source, evidenceRef: row.evidenceRef, updatedAt: new Date(),
    },
  });
}
