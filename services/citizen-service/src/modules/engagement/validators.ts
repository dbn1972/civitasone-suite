import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";
import type { SurveyQuestion, SurveyAnswerValue } from "./schema.js";

export const idParam = z.object({ id: z.string().uuid() });

export const NOTICE_TYPES = ["statutory", "public_hearing", "tender", "general"] as const;
export const QUESTION_TYPES = ["text", "single_choice", "multi_choice", "rating"] as const;

const futureIso = z.string().datetime({ offset: true })
  .refine((v) => new Date(v).getTime() > Date.now(), { message: "must be in the future" });

export const createAlertBody = z.object({
  title:          safeText({ max: 200 }),
  body:           safeText({ max: 4000, min: 0, multiline: true }).optional(),
  category:       safeText({ max: 64 }).optional(),
  targetAudience: safeText({ max: 128 }).optional(),
  expiresAt:      futureIso.optional(),
});
export type CreateAlertBody = z.infer<typeof createAlertBody>;

export const createNoticeBody = z.object({
  noticeNo:   z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,63}$/)
    // NTC-YYYY-NNNNNN is the sequence-allocated auto-number space; a supplied value there could collide with a future one.
    .refine((v) => !/^NTC-\d{4}-\d{1,9}$/i.test(v), "NTC-YYYY-NNNNNN is reserved for auto-numbering")
    .optional(),
  subject:    safeText({ max: 300 }),
  body:       safeText({ max: 8000, min: 0, multiline: true }).optional(),
  department: safeText({ max: 128 }),
  type:       z.enum(NOTICE_TYPES).optional(),
  expiresAt:  futureIso.optional(),
});
export type CreateNoticeBody = z.infer<typeof createNoticeBody>;

const questionSchema = z.object({
  id:       z.string().regex(/^[a-z0-9_-]{1,32}$/),
  text:     safeText({ max: 300 }),
  type:     z.enum(QUESTION_TYPES),
  options:  z.array(safeText({ max: 120 })).max(20).optional(),
  required: z.boolean().optional(),
}).refine((q) => (q.type === "single_choice" || q.type === "multi_choice") ? (q.options?.length ?? 0) >= 2 : true, {
  message: "choice questions need at least two options",
});

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "invalid date");

export const createSurveyBody = z.object({
  surveyName:      safeText({ max: 200 }),
  description:     safeText({ max: 4000, min: 0, multiline: true }).optional(),
  questions:       z.array(questionSchema).min(1).max(50),
  targetResponses: z.number().int().min(1).max(10_000_000).optional(),
  startsOn:        isoDay.optional(),
  endsOn:          isoDay.optional(),
}).refine((b) => new Set(b.questions.map((q) => q.id)).size === b.questions.length, {
  message: "question ids must be unique", path: ["questions"],
}).refine((b) => !b.startsOn || !b.endsOn || b.endsOn >= b.startsOn, {
  message: "endsOn must be on or after startsOn", path: ["endsOn"],
});
export type CreateSurveyBody = z.infer<typeof createSurveyBody>;

export const submitResponseBody = z.object({
  answers: z.record(
    z.string().regex(/^[a-z0-9_-]{1,32}$/),
    z.union([
      safeText({ max: 2000, min: 0, multiline: true }),
      z.number().finite(),
      z.array(safeText({ max: 120 })).max(20),
    ]),
  ),
});
export type SubmitResponseBody = z.infer<typeof submitResponseBody>;

export const listQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
  /** Staff-only filter; ignored (forced to the public set) for bare citizens. */
  status: z.string().max(16).optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

/** Validates survey answers against the survey's own question set. Returns error strings (empty = valid). */
export function validateAnswers(questions: SurveyQuestion[], answers: Record<string, SurveyAnswerValue>): string[] {
  const errors: string[] = [];
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const key of Object.keys(answers)) {
    if (!byId.has(key)) errors.push(`unknown question "${key}"`);
  }
  for (const q of questions) {
    const v = answers[q.id];
    const missing = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    if (missing) {
      if (q.required) errors.push(`question "${q.id}" is required`);
      continue;
    }
    if (q.type === "text") {
      if (typeof v !== "string") errors.push(`question "${q.id}" expects text`);
    } else if (q.type === "rating") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) errors.push(`question "${q.id}" expects a rating 1-5`);
    } else if (q.type === "single_choice") {
      if (typeof v !== "string" || !(q.options ?? []).includes(v)) errors.push(`question "${q.id}" expects one of its options`);
    } else if (q.type === "multi_choice") {
      if (!Array.isArray(v) || v.some((x) => !(q.options ?? []).includes(x))) errors.push(`question "${q.id}" expects a subset of its options`);
    }
  }
  return errors;
}
