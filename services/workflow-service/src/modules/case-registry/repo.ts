import { randomUUID } from "node:crypto";
import { eq, and, desc, isNull } from "drizzle-orm";
import { db, scopedRead, type Db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cases, caseDeviations } from "./schema.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// CAP-031 — every read runs inside the tenant GUC scope (scopedRead) because
// workflow.cases is now FORCE-RLS + fail-closed and workflow_svc is NOBYPASSRLS;
// a bare db.select() carries no app.tenant_id and returns zero rows.
export async function listCases(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(cases)
    .where(and(eq(cases.tenantId, tenantId), isNull(cases.mergedIntoCaseId)))
    .orderBy(desc(cases.createdAt)).limit(limit));
}
export async function findCase(tenantId: string, id: string) {
  const rows = await scopedRead((tx) => tx.select().from(cases)
    .where(and(eq(cases.id, id), eq(cases.tenantId, tenantId))).limit(1));
  return rows[0];
}
export async function findChildren(tenantId: string, parentId: string) {
  return scopedRead((tx) => tx.select().from(cases)
    .where(and(eq(cases.tenantId, tenantId), eq(cases.parentCaseId, parentId))));
}
export async function listDeviations(tenantId: string, caseId: string) {
  return scopedRead((tx) => tx.select().from(caseDeviations)
    .where(and(eq(caseDeviations.tenantId, tenantId), eq(caseDeviations.caseId, caseId)))
    .orderBy(desc(caseDeviations.createdAt)));
}

export interface RegisterInput {
  tenantId: string;
  title: string;
  caseType: string;
  sourceService: string;
  sourceRefId: string;
  priority?: string;
  metadata?: Record<string, unknown>;
  actorId: string;
  correlationId: string;
  caseNumber?: string;
}

/**
 * CAP-031 — register (or idempotently return) a case in the cross-domain
 * registry within the caller's transaction. Uniqueness is
 * (tenant, source_service, source_ref_id) so replaying a domain case-created
 * event never creates a duplicate.
 */
export async function registerCaseTx(tx: Tx, input: RegisterInput): Promise<{ id: string; created: boolean }> {
  const id = randomUUID();
  const caseNumber = input.caseNumber ?? `CASE-${Date.now()}-${id.slice(0, 6)}`;
  const inserted = await tx.insert(cases).values({
    id, tenantId: input.tenantId, caseNumber, title: input.title,
    caseType: input.caseType, sourceService: input.sourceService, sourceRefId: input.sourceRefId,
    priority: input.priority ?? "normal", status: "open", metadata: input.metadata ?? {},
    createdBy: input.actorId, version: 1,
  }).onConflictDoNothing({ target: [cases.tenantId, cases.sourceService, cases.sourceRefId] }).returning({ id: cases.id });
  if (inserted.length === 0) {
    const existing = await tx.select({ id: cases.id }).from(cases)
      .where(and(eq(cases.tenantId, input.tenantId), eq(cases.sourceService, input.sourceService), eq(cases.sourceRefId, input.sourceRefId))).limit(1);
    return { id: existing[0]?.id ?? id, created: false };
  }
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: input.tenantId, actorId: input.actorId, correlationId: input.correlationId,
    payload: { service: "workflow", action: "register_case", resourceType: "case", resourceId: id, outcome: "success", detail: { sourceService: input.sourceService, caseType: input.caseType } },
  });
  return { id, created: true };
}

/** Route entry point — opens the tenant transaction then delegates. */
export async function registerCase(input: RegisterInput): Promise<{ id: string; created: boolean }> {
  return db.transaction((tx) => registerCaseTx(tx as Tx, input));
}
