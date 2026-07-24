import { and, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  questionBanks, questions, assessments, attempts, attemptAnswers, certificates,
  type QuestionRow, type AssessmentRow, type AttemptRow, type CertificateRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── question banks ────────────────────────────────────────────────
export async function insertBank(tx: Writer, row: typeof questionBanks.$inferInsert): Promise<void> {
  await tx.insert(questionBanks).values(row);
}
export async function listBanks(tenantId: string, limit = 100) {
  return scopedRead((t) => t.select().from(questionBanks)
    .where(eq(questionBanks.tenantId, tenantId)).limit(limit));
}
export async function getBank(tenantId: string, id: string) {
  const rows = await scopedRead((t) => t.select().from(questionBanks)
    .where(and(eq(questionBanks.id, id), eq(questionBanks.tenantId, tenantId))).limit(1));
  return rows[0];
}

// ── questions ─────────────────────────────────────────────────────
export async function insertQuestion(tx: Writer, row: typeof questions.$inferInsert): Promise<void> {
  await tx.insert(questions).values(row);
}
export async function listQuestions(tenantId: string, bankId: string): Promise<QuestionRow[]> {
  return scopedRead((t) => t.select().from(questions)
    .where(and(eq(questions.tenantId, tenantId), eq(questions.bankId, bankId))));
}

// ── assessments ───────────────────────────────────────────────────
export async function insertAssessment(tx: Writer, row: typeof assessments.$inferInsert): Promise<void> {
  await tx.insert(assessments).values(row);
}
export async function getAssessment(tenantId: string, id: string): Promise<AssessmentRow | undefined> {
  const rows = await scopedRead((t) => t.select().from(assessments)
    .where(and(eq(assessments.id, id), eq(assessments.tenantId, tenantId))).limit(1));
  return rows[0];
}
export async function listAssessments(tenantId: string, limit = 100) {
  return scopedRead((t) => t.select().from(assessments)
    .where(eq(assessments.tenantId, tenantId)).limit(limit));
}
/** draft → pending_approval. Guarded to draft so re-submit is a no-op. */
export async function submitForApproval(tx: Writer, tenantId: string, id: string): Promise<AssessmentRow | null> {
  const rows = await tx.update(assessments)
    .set({ status: "pending_approval" })
    .where(and(eq(assessments.id, id), eq(assessments.tenantId, tenantId), eq(assessments.status, "draft")))
    .returning();
  return rows[0] ?? null;
}
/** pending_approval → published. Guarded to pending_approval (idempotent). */
export async function publishAssessment(tx: Writer, tenantId: string, id: string, approvedBy: string): Promise<AssessmentRow | null> {
  const rows = await tx.update(assessments)
    .set({ status: "published", approvedBy, publishedAt: new Date() })
    .where(and(eq(assessments.id, id), eq(assessments.tenantId, tenantId), eq(assessments.status, "pending_approval")))
    .returning();
  return rows[0] ?? null;
}
export async function retireAssessment(tx: Writer, tenantId: string, id: string): Promise<AssessmentRow | null> {
  const rows = await tx.update(assessments)
    .set({ status: "retired" })
    .where(and(eq(assessments.id, id), eq(assessments.tenantId, tenantId), eq(assessments.status, "published")))
    .returning();
  return rows[0] ?? null;
}
/** Passing-score change is only permitted on a draft (maker-checker gate below). */
export async function updatePassingScore(tx: Writer, tenantId: string, id: string, passingScore: string): Promise<AssessmentRow | null> {
  const rows = await tx.update(assessments)
    .set({ passingScore })
    .where(and(eq(assessments.id, id), eq(assessments.tenantId, tenantId), eq(assessments.status, "draft")))
    .returning();
  return rows[0] ?? null;
}

// ── attempts ──────────────────────────────────────────────────────
export async function countAttempts(tenantId: string, assessmentId: string, employeeId: string): Promise<number> {
  const rows = await scopedRead((t) => t
    .select({ n: sql<number>`count(*)::int` })
    .from(attempts)
    .where(and(
      eq(attempts.tenantId, tenantId),
      eq(attempts.assessmentId, assessmentId),
      eq(attempts.employeeId, employeeId),
    )));
  return rows[0]?.n ?? 0;
}
export async function insertAttempt(tx: Writer, row: typeof attempts.$inferInsert): Promise<AttemptRow> {
  const rows = await tx.insert(attempts).values(row).returning();
  return rows[0]!;
}
export async function getAttempt(tenantId: string, id: string): Promise<AttemptRow | undefined> {
  const rows = await scopedRead((t) => t.select().from(attempts)
    .where(and(eq(attempts.id, id), eq(attempts.tenantId, tenantId))).limit(1));
  return rows[0];
}
/** in_progress → graded. Guarded to in_progress so a resubmit is a no-op. */
export async function gradeAttemptRow(
  tx: Writer, tenantId: string, id: string,
  data: { score: string; passed: boolean },
): Promise<AttemptRow | null> {
  const rows = await tx.update(attempts)
    .set({ status: "graded", submittedAt: new Date(), score: data.score, passed: data.passed })
    .where(and(eq(attempts.id, id), eq(attempts.tenantId, tenantId), eq(attempts.status, "in_progress")))
    .returning();
  return rows[0] ?? null;
}
export async function insertAnswers(tx: Writer, rows: Array<typeof attemptAnswers.$inferInsert>): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(attemptAnswers).values(rows);
}

// ── certificates ──────────────────────────────────────────────────
export async function getCertificateByAttempt(tenantId: string, attemptId: string): Promise<CertificateRow | undefined> {
  const rows = await scopedRead((t) => t.select().from(certificates)
    .where(and(eq(certificates.attemptId, attemptId), eq(certificates.tenantId, tenantId))).limit(1));
  return rows[0];
}
export async function getCertificateByToken(verifyToken: string): Promise<CertificateRow | undefined> {
  // Token is a globally-unique secret; scoped-read still enforces RLS via GUC.
  const rows = await scopedRead((t) => t.select().from(certificates)
    .where(eq(certificates.verifyToken, verifyToken)).limit(1));
  return rows[0];
}
/**
 * Insert a certificate. UNIQUE(attempt_id) makes issuance idempotent: a second
 * insert for the same attempt is swallowed (onConflictDoNothing) and the caller
 * treats a missing return as "already issued".
 */
export async function insertCertificate(tx: Writer, row: typeof certificates.$inferInsert): Promise<CertificateRow | null> {
  const rows = await tx.insert(certificates).values(row).onConflictDoNothing({ target: certificates.attemptId }).returning();
  return rows[0] ?? null;
}
