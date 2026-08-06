/**
 * G7 checklist reads. Every read goes through `scopedRead` so it runs inside a tenant
 * transaction and PostgreSQL RLS is enforced — a bare `db.select()` on a FORCE-RLS
 * table returns zero rows rather than failing loudly.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import type { ChecklistResponses, ChecklistSection } from "@civitasone/checklist";
import {
  checklistInstances,
  checklistTemplates,
  type ChecklistInstanceRow,
  type ChecklistInstanceView,
  type ChecklistTemplateRow,
  type ChecklistTemplateView,
} from "./schema.js";

/** JSONB comes back as `unknown`; the column is only ever written by this module. */
function sectionsOf(value: unknown): ChecklistSection[] {
  return Array.isArray(value) ? (value as ChecklistSection[]) : [];
}

function responsesOf(value: unknown): ChecklistResponses {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ChecklistResponses)
    : {};
}

export function toTemplateView(r: ChecklistTemplateRow): ChecklistTemplateView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    templateKey: r.templateKey,
    name: r.name,
    description: r.description,
    sections: sectionsOf(r.sections),
    versionNumber: r.versionNumber,
    status: r.status,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export function toInstanceView(r: ChecklistInstanceRow): ChecklistInstanceView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    templateId: r.templateId,
    templateKey: r.templateKey,
    templateVersionNumber: r.templateVersionNumber,
    structure: sectionsOf(r.structure),
    responses: responsesOf(r.responses),
    status: r.status,
    score: r.score,
    completedAt: r.completedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

// ── templates ───────────────────────────────────────────────────────────────────

export async function findTemplateById(
  id: string,
  tenantId: string,
): Promise<ChecklistTemplateView | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(checklistTemplates)
      .where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.tenantId, tenantId)))
      .limit(1),
  );
  const row = rows[0];
  return row ? toTemplateView(row) : null;
}

/** The single published version of a key, or null. Guarded unique in migration 0085. */
export async function findPublishedTemplateByKey(
  templateKey: string,
  tenantId: string,
): Promise<ChecklistTemplateView | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(checklistTemplates)
      .where(
        and(
          eq(checklistTemplates.tenantId, tenantId),
          eq(checklistTemplates.templateKey, templateKey),
          eq(checklistTemplates.status, "published"),
        ),
      )
      .orderBy(desc(checklistTemplates.versionNumber))
      .limit(1),
  );
  const row = rows[0];
  return row ? toTemplateView(row) : null;
}

/** Highest `versionNumber` in use for a key, or null when the key is new. */
export async function highestVersionNumber(
  templateKey: string,
  tenantId: string,
): Promise<number | null> {
  const rows = (await scopedRead((tx) =>
    tx
      .select({ highest: sql<number | null>`max(${checklistTemplates.versionNumber})` })
      .from(checklistTemplates)
      .where(
        and(
          eq(checklistTemplates.tenantId, tenantId),
          eq(checklistTemplates.templateKey, templateKey),
        ),
      ),
  )) as Array<{ highest: number | null }>;
  const highest = rows[0]?.highest;
  return highest === null || highest === undefined ? null : Number(highest);
}

export interface TemplateFilters {
  templateKey?: string;
  status?: string;
}

export async function listTemplates(
  tenantId: string,
  limit: number,
  offset: number,
  filters: TemplateFilters = {},
): Promise<{ rows: ChecklistTemplateView[]; total: number }> {
  const where = and(
    eq(checklistTemplates.tenantId, tenantId),
    ...(filters.templateKey ? [eq(checklistTemplates.templateKey, filters.templateKey)] : []),
    ...(filters.status ? [eq(checklistTemplates.status, filters.status)] : []),
  );
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(checklistTemplates)
      .where(where)
      .orderBy(asc(checklistTemplates.templateKey), desc(checklistTemplates.versionNumber))
      .limit(limit)
      .offset(offset);
    const counted = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(checklistTemplates)
      .where(where);
    return { rows: rows.map(toTemplateView), total: counted[0]?.total ?? 0 };
  });
}

// ── instances ───────────────────────────────────────────────────────────────────

export async function findInstanceById(
  id: string,
  tenantId: string,
): Promise<ChecklistInstanceView | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(checklistInstances)
      .where(and(eq(checklistInstances.id, id), eq(checklistInstances.tenantId, tenantId)))
      .limit(1),
  );
  const row = rows[0];
  return row ? toInstanceView(row) : null;
}

/** The open instance of a template key against one subject, if any. */
export async function findOpenInstance(
  tenantId: string,
  subjectType: string,
  subjectId: string,
  templateKey: string,
): Promise<ChecklistInstanceView | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(checklistInstances)
      .where(
        and(
          eq(checklistInstances.tenantId, tenantId),
          eq(checklistInstances.subjectType, subjectType),
          eq(checklistInstances.subjectId, subjectId),
          eq(checklistInstances.templateKey, templateKey),
          eq(checklistInstances.status, "in_progress"),
        ),
      )
      .limit(1),
  );
  const row = rows[0];
  return row ? toInstanceView(row) : null;
}

export interface InstanceFilters {
  subjectType?: string;
  subjectId?: string;
  status?: string;
  templateKey?: string;
}

export async function listInstances(
  tenantId: string,
  limit: number,
  offset: number,
  filters: InstanceFilters = {},
): Promise<{ rows: ChecklistInstanceView[]; total: number }> {
  const where = and(
    eq(checklistInstances.tenantId, tenantId),
    ...(filters.subjectType ? [eq(checklistInstances.subjectType, filters.subjectType)] : []),
    ...(filters.subjectId ? [eq(checklistInstances.subjectId, filters.subjectId)] : []),
    ...(filters.status ? [eq(checklistInstances.status, filters.status)] : []),
    ...(filters.templateKey ? [eq(checklistInstances.templateKey, filters.templateKey)] : []),
  );
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(checklistInstances)
      .where(where)
      .orderBy(desc(checklistInstances.updatedAt))
      .limit(limit)
      .offset(offset);
    const counted = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(checklistInstances)
      .where(where);
    return { rows: rows.map(toInstanceView), total: counted[0]?.total ?? 0 };
  });
}
