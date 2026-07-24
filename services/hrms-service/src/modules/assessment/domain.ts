/**
 * Assessment & Certification — pure domain logic (SVC-123).
 *
 * These functions are DB-free and deterministic so they can be unit-tested in
 * isolation. All identifier/token generation (crypto.randomUUID) and clock
 * access (new Date) happen in the repo/route layer and are passed IN here, so
 * the domain stays pure — mirrors the codebase convention of keeping shared
 * domain code free of Math.random / ambient time.
 */

export type Qtype = "single" | "multi" | "truefalse";

export interface GradableQuestion {
  id: string;
  qtype: Qtype;
  /** Set of option ids that constitute the correct answer. */
  correct: string[];
  /** Full marks awarded when the response matches. */
  marks: number;
}

export interface SubmittedAnswer {
  questionId: string;
  /** Option ids the candidate selected. */
  response: string[];
}

export interface PerQuestionGrade {
  questionId: string;
  awarded: number;
}

export interface GradeResult {
  perQuestion: PerQuestionGrade[];
  score: number;
}

/** Order-independent set equality over string arrays (dedupes both sides). */
function setEqual(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/**
 * Auto-grade an attempt.
 *
 *  - single / truefalse: full marks on an EXACT match of the (single-element)
 *    correct set, otherwise 0.
 *  - multi: full marks ONLY when the selected set equals the correct set
 *    exactly; ANY missing or extra selection yields 0 (no partial credit).
 *    This all-or-nothing rule is intentional and documented.
 *
 * Unanswered questions (no submitted answer) award 0. Returns per-question
 * awards plus the summed score.
 */
export function gradeAttempt(
  questions: GradableQuestion[],
  answers: SubmittedAnswer[],
): GradeResult {
  const byQuestion = new Map<string, string[]>();
  for (const a of answers) byQuestion.set(a.questionId, a.response ?? []);

  const perQuestion: PerQuestionGrade[] = [];
  let score = 0;
  for (const q of questions) {
    const response = byQuestion.get(q.id) ?? [];
    // single, truefalse and multi all reduce to exact set-equality here; the
    // qtype is retained for validation/authoring, not for the grading rule.
    const correctResponse = setEqual(response, q.correct);
    const awarded = correctResponse ? q.marks : 0;
    perQuestion.push({ questionId: q.id, awarded });
    score += awarded;
  }
  return { perQuestion, score };
}

/** Pass when the achieved score meets OR exceeds the passing score (== passes). */
export function decidePass(score: number, passingScore: number): boolean {
  return score >= passingScore;
}

/** A further attempt is allowed only while prior attempts are below the cap. */
export function canAttempt(existingAttemptCount: number, maxAttempts: number): boolean {
  return existingAttemptCount < maxAttempts;
}

export interface CertificateInputs {
  /** Pre-generated (crypto) certificate number, passed in to keep domain pure. */
  certificateNo: string;
  /** Pre-generated (crypto) verification token, passed in to keep domain pure. */
  verifyToken: string;
  /** Wall-clock issuance time, passed in to keep domain pure. */
  issuedAt: Date;
  /** When set, certificate expires issuedAt + validityMonths; else never. */
  validityMonths?: number | null;
}

export interface IssuedCertificate {
  certificateNo: string;
  verifyToken: string;
  validUntil: Date | null;
}

/**
 * Compute the issued-certificate fields. validUntil = issuedAt + validityMonths
 * when a validity window is configured, otherwise null (no expiry).
 */
export function issueCertificate(
  _assessment: { validityMonths?: number | null },
  _attempt: unknown,
  opts: CertificateInputs,
): IssuedCertificate {
  let validUntil: Date | null = null;
  const months = opts.validityMonths;
  if (months != null && months > 0) {
    validUntil = new Date(opts.issuedAt.getTime());
    validUntil.setMonth(validUntil.getMonth() + months);
  }
  return {
    certificateNo: opts.certificateNo,
    verifyToken: opts.verifyToken,
    validUntil,
  };
}

export interface EvaluableCertificate {
  status: string;
  validUntil: Date | null;
}

/**
 * Effective certificate status as of `asOf`:
 *  - 'revoked' wins (an admin action) regardless of dates;
 *  - 'expired' when a validUntil is set and asOf is past it;
 *  - otherwise 'active'.
 */
export function evaluateCertificateStatus(
  cert: EvaluableCertificate,
  asOf: Date,
): "active" | "expired" | "revoked" {
  if (cert.status === "revoked") return "revoked";
  if (cert.validUntil != null && asOf.getTime() > cert.validUntil.getTime()) return "expired";
  return "active";
}
