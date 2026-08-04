/**
 * LQ-001 persistence for qualification frameworks/questions and lead qualifications.
 *
 * Framework/question admin CRUD is synchronous + transactional with an audit event
 * (the dedup-rules pattern): a config change commits atomically with its audit row.
 * The qualify submission is async CQRS (see qualification-commands/-consumer).
 */
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import {
  qualificationFrameworks,
  qualificationQuestions,
  leadQualifications,
  type QualificationFrameworkRow,
  type QualificationQuestionRow,
  type LeadQualificationRow,
} from "./qualification-schema.js";
import type { QuestionInput } from "./qualification-validators.js";
import type { QualificationQuestion } from "./qualification-domain.js";

const AUDIT_TOPIC = "audit.event.record";

export interface QuestionView {
  id: string;
  prompt: string;
  answerType: string;
  weight: number;
  outcomeRule: Record<string, unknown>;
  order: number;
}
export interface FrameworkView {
  id: string;
  name: string;
  businessLine: string | null;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  questions: QuestionView[];
}

function toQuestionView(r: QualificationQuestionRow): QuestionView {
  return {
    id: r.id,
    prompt: r.prompt,
    answerType: r.answerType,
    weight: r.weight,
    outcomeRule: (r.outcomeRule as Record<string, unknown>) ?? {},
    order: r.order,
  };
}
function toFrameworkView(f: QualificationFrameworkRow, questions: QualificationQuestionRow[]): FrameworkView {
  return {
    id: f.id,
    name: f.name,
    businessLine: f.businessLine,
    active: f.active,
    version: f.version,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    questions: questions.map(toQuestionView),
  };
}

export async function listFrameworks(
  tenantId: string,
  filters: { businessLine?: string; active?: boolean } = {},
): Promise<FrameworkView[]> {
  const conds = [eq(qualificationFrameworks.tenantId, tenantId)];
  if (filters.businessLine) conds.push(eq(qualificationFrameworks.businessLine, filters.businessLine));
  if (filters.active !== undefined) conds.push(eq(qualificationFrameworks.active, filters.active));

  return scopedRead(async (tx) => {
    const frameworks = await tx.select().from(qualificationFrameworks)
      .where(and(...conds))
      .orderBy(asc(qualificationFrameworks.name));
    if (frameworks.length === 0) return [];
    const ids = frameworks.map((f) => f.id);
    const questions = await tx.select().from(qualificationQuestions)
      .where(and(
        eq(qualificationQuestions.tenantId, tenantId),
        inArray(qualificationQuestions.frameworkId, ids),
      ))
      .orderBy(asc(qualificationQuestions.order));
    return frameworks.map((f) => toFrameworkView(f, questions.filter((q) => q.frameworkId === f.id)));
  });
}

export async function getFramework(tenantId: string, id: string): Promise<FrameworkView | null> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(qualificationFrameworks)
      .where(and(eq(qualificationFrameworks.tenantId, tenantId), eq(qualificationFrameworks.id, id)))
      .limit(1);
    if (rows.length === 0) return null;
    const questions = await tx.select().from(qualificationQuestions)
      .where(and(
        eq(qualificationQuestions.tenantId, tenantId),
        eq(qualificationQuestions.frameworkId, id),
      ))
      .orderBy(asc(qualificationQuestions.order));
    return toFrameworkView(rows[0]!, questions);
  });
}

/** Domain-shaped questions for scoring a qualify submission. */
export async function getScoringQuestions(tenantId: string, frameworkId: string): Promise<QualificationQuestion[]> {
  const rows = await scopedRead((tx) => tx.select().from(qualificationQuestions)
    .where(and(
      eq(qualificationQuestions.tenantId, tenantId),
      eq(qualificationQuestions.frameworkId, frameworkId),
    ))
    .orderBy(asc(qualificationQuestions.order)));
  return rows.map((q) => ({
    id: q.id,
    answerType: q.answerType as QualificationQuestion["answerType"],
    weight: q.weight,
    outcomeRule: (q.outcomeRule as Record<string, unknown>) ?? {},
    order: q.order,
  }));
}

async function auditFramework(
  tx: Parameters<typeof enqueue>[0],
  tenantId: string,
  actorId: string,
  correlationId: string,
  action: string,
  frameworkId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId,
    actorId,
    correlationId,
    payload: {
      service: "crm",
      action,
      resourceType: "qualification_framework",
      resourceId: frameworkId,
      outcome: "success",
    },
  });
}

async function insertQuestions(
  tx: typeof db,
  tenantId: string,
  frameworkId: string,
  actorId: string,
  questions: QuestionInput[],
): Promise<void> {
  for (const q of questions) {
    await tx.insert(qualificationQuestions).values({
      frameworkId,
      tenantId,
      prompt: q.prompt,
      answerType: q.answerType,
      weight: q.weight,
      outcomeRule: q.outcomeRule,
      order: q.order,
      createdBy: actorId,
      updatedBy: actorId,
    });
  }
}

export async function createFramework(
  tenantId: string,
  actorId: string,
  correlationId: string,
  body: { name: string; businessLine?: string | undefined; active?: boolean | undefined; questions?: QuestionInput[] | undefined },
): Promise<FrameworkView> {
  const id = await db.transaction(async (tx) => {
    const inserted = await tx.insert(qualificationFrameworks).values({
      tenantId,
      name: body.name,
      businessLine: body.businessLine ?? null,
      active: body.active ?? true,
      createdBy: actorId,
      updatedBy: actorId,
    }).returning({ id: qualificationFrameworks.id });
    const fwId = inserted[0]!.id;
    if (body.questions && body.questions.length > 0) {
      await insertQuestions(tx as typeof db, tenantId, fwId, actorId, body.questions);
    }
    await auditFramework(tx as Parameters<typeof enqueue>[0], tenantId, actorId, correlationId, "qualification_framework_create", fwId);
    return fwId;
  });
  return (await getFramework(tenantId, id))!;
}

export async function updateFramework(
  tenantId: string,
  actorId: string,
  correlationId: string,
  id: string,
  body: { name?: string | undefined; businessLine?: string | null | undefined; active?: boolean | undefined; questions?: QuestionInput[] | undefined },
): Promise<FrameworkView | null> {
  const existed = await db.transaction(async (tx) => {
    const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actorId, version: sql`${qualificationFrameworks.version} + 1` };
    if (body.name !== undefined) set.name = body.name;
    if (body.businessLine !== undefined) set.businessLine = body.businessLine;
    if (body.active !== undefined) set.active = body.active;
    const updated = await tx.update(qualificationFrameworks)
      .set(set)
      .where(and(eq(qualificationFrameworks.tenantId, tenantId), eq(qualificationFrameworks.id, id)))
      .returning({ id: qualificationFrameworks.id });
    if (updated.length === 0) return false;
    // A present questions array replaces the whole set (delete + reinsert).
    if (body.questions !== undefined) {
      await tx.delete(qualificationQuestions)
        .where(and(eq(qualificationQuestions.tenantId, tenantId), eq(qualificationQuestions.frameworkId, id)));
      if (body.questions.length > 0) {
        await insertQuestions(tx as typeof db, tenantId, id, actorId, body.questions);
      }
    }
    await auditFramework(tx as Parameters<typeof enqueue>[0], tenantId, actorId, correlationId, "qualification_framework_update", id);
    return true;
  });
  if (!existed) return null;
  return getFramework(tenantId, id);
}

export async function deleteFramework(
  tenantId: string,
  actorId: string,
  correlationId: string,
  id: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const deleted = await tx.delete(qualificationFrameworks)
      .where(and(eq(qualificationFrameworks.tenantId, tenantId), eq(qualificationFrameworks.id, id)))
      .returning({ id: qualificationFrameworks.id });
    if (deleted.length === 0) return false;
    // Questions are ON DELETE CASCADE at the DB; audit the config change.
    await auditFramework(tx as Parameters<typeof enqueue>[0], tenantId, actorId, correlationId, "qualification_framework_delete", id);
    return true;
  });
}

// ── Lead qualifications (submitted results) ─────────────────────────────────────

export interface LeadQualificationInsert {
  id: string;
  tenantId: string;
  leadId: string;
  frameworkId: string;
  answers: Record<string, unknown>;
  outcome: string;
  score: number;
  qualifiedBy: string;
}

export async function insertLeadQualification(
  tx: Pick<typeof db, "insert">,
  row: LeadQualificationInsert,
): Promise<void> {
  await tx.insert(leadQualifications).values({
    id: row.id,
    tenantId: row.tenantId,
    leadId: row.leadId,
    frameworkId: row.frameworkId,
    answers: row.answers,
    outcome: row.outcome,
    score: row.score,
    qualifiedBy: row.qualifiedBy,
  });
}

export interface LeadQualificationView {
  id: string;
  leadId: string;
  frameworkId: string;
  answers: Record<string, unknown>;
  outcome: string;
  score: number;
  qualifiedBy: string;
  createdAt: string;
}
function toLeadQualificationView(r: LeadQualificationRow): LeadQualificationView {
  return {
    id: r.id,
    leadId: r.leadId,
    frameworkId: r.frameworkId,
    answers: (r.answers as Record<string, unknown>) ?? {},
    outcome: r.outcome,
    score: r.score,
    qualifiedBy: r.qualifiedBy,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listLeadQualifications(tenantId: string, leadId: string): Promise<LeadQualificationView[]> {
  const rows = await scopedRead((tx) => tx.select().from(leadQualifications)
    .where(and(eq(leadQualifications.tenantId, tenantId), eq(leadQualifications.leadId, leadId)))
    .orderBy(desc(leadQualifications.createdAt)));
  return rows.map(toLeadQualificationView);
}
