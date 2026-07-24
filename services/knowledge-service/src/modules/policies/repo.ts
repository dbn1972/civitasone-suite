import { eq, and, desc, ilike, or, lte, isNotNull } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import {
  policyDocuments,
  policyAcknowledgements,
  type PolicyRow,
  type PolicyInsert,
  type PolicyView,
  type AckInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

/** Tenant-scoped read: sets the GUC from the JWT-derived tenant so RLS is enforced. */
function readAs<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return Promise.resolve(runWithTenant(tenantId, () => scopedRead(fn))) as Promise<T>;
}

function iso(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : v;
}

export function toView(r: PolicyRow): PolicyView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    docType: r.docType,
    referenceNo: r.referenceNo,
    title: r.title,
    body: r.body,
    status: r.status,
    authorId: r.authorId,
    reviewerId: r.reviewerId,
    approverId: r.approverId,
    effectiveDate: r.effectiveDate ?? null,
    reviewDueDate: r.reviewDueDate ?? null,
    supersedesId: r.supersedesId,
    version: r.version,
    publishedAt: iso(r.publishedAt),
    createdAt: iso(r.createdAt)!,
    updatedAt: iso(r.updatedAt)!,
  };
}

export async function listByTenant(
  tenantId: string,
  filters: { status?: string; docType?: string },
  limit: number,
  offset: number,
): Promise<PolicyView[]> {
  const conds = [
    eq(policyDocuments.tenantId, tenantId),
    ...(filters.status ? [eq(policyDocuments.status, filters.status)] : []),
    ...(filters.docType ? [eq(policyDocuments.docType, filters.docType)] : []),
  ];
  const rows = await readAs(tenantId, (tx) =>
    tx.select().from(policyDocuments)
      .where(and(...conds))
      .orderBy(desc(policyDocuments.updatedAt))
      .limit(limit)
      .offset(offset),
  );
  return rows.map(toView);
}

export async function getById(tenantId: string, id: string): Promise<PolicyView | null> {
  const rows = await readAs(tenantId, (tx) =>
    tx.select().from(policyDocuments)
      .where(and(eq(policyDocuments.id, id), eq(policyDocuments.tenantId, tenantId))),
  );
  return rows.length ? toView(rows[0]!) : null;
}

/** Published documents whose review date is on or before `asOf`. */
export async function reviewDue(tenantId: string, asOf: string): Promise<PolicyView[]> {
  const rows = await readAs(tenantId, (tx) =>
    tx.select().from(policyDocuments)
      .where(and(
        eq(policyDocuments.tenantId, tenantId),
        eq(policyDocuments.status, "published"),
        isNotNull(policyDocuments.reviewDueDate),
        lte(policyDocuments.reviewDueDate, asOf),
      ))
      .orderBy(policyDocuments.reviewDueDate),
  );
  return rows.map(toView);
}

/** Published policies grounding the assistant, matched by keyword. */
export async function searchPublished(
  tenantId: string,
  keyword: string,
  limit: number,
): Promise<PolicyView[]> {
  const rows = await readAs(tenantId, (tx) =>
    tx.select().from(policyDocuments)
      .where(and(
        eq(policyDocuments.tenantId, tenantId),
        eq(policyDocuments.status, "published"),
        or(ilike(policyDocuments.title, `%${keyword}%`), ilike(policyDocuments.body, `%${keyword}%`)),
      ))
      .orderBy(desc(policyDocuments.publishedAt))
      .limit(limit),
  );
  return rows.map(toView);
}

export async function listAckEmployeeIds(tenantId: string, policyId: string): Promise<string[]> {
  const rows = await readAs(tenantId, (tx) =>
    tx.select({ employeeId: policyAcknowledgements.employeeId })
      .from(policyAcknowledgements)
      .where(and(
        eq(policyAcknowledgements.tenantId, tenantId),
        eq(policyAcknowledgements.policyId, policyId),
      )),
  );
  return rows.map((r) => r.employeeId);
}

export async function insert(tx: Writer, row: PolicyInsert): Promise<void> {
  await tx.insert(policyDocuments).values(row);
}

export async function update(tx: Writer, id: string, data: Partial<PolicyInsert>): Promise<void> {
  await tx.update(policyDocuments).set(data).where(eq(policyDocuments.id, id));
}

export async function insertAck(tx: Writer, row: AckInsert): Promise<void> {
  await tx.insert(policyAcknowledgements).values(row).onConflictDoNothing();
}
