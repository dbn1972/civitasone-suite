import { z } from "zod";

export const createBankBody = z.object({
  title:         z.string().min(1).max(256),
  competencyRef: z.string().max(256).optional(),
});
export type CreateBankBody = z.infer<typeof createBankBody>;

const optionSchema = z.object({ id: z.string().min(1).max(64), text: z.string().min(1).max(512) });

export const createQuestionBody = z.object({
  qtype:   z.enum(["single", "multi", "truefalse"]),
  stem:    z.string().min(1).max(2048),
  options: z.array(optionSchema).min(1).max(20),
  correct: z.array(z.string().min(1).max(64)).min(1),
  marks:   z.number().positive().max(1000),
});
export type CreateQuestionBody = z.infer<typeof createQuestionBody>;

export const createAssessmentBody = z.object({
  title:          z.string().min(1).max(256),
  courseRef:      z.string().max(256).optional(),
  bankId:         z.string().uuid(),
  passingScore:   z.number().min(0).max(100000),
  durationMins:   z.number().int().positive().max(1440).default(30),
  maxAttempts:    z.number().int().positive().max(20).default(1),
  validityMonths: z.number().int().positive().max(240).optional(),
});
export type CreateAssessmentBody = z.infer<typeof createAssessmentBody>;

export const updatePassingScoreBody = z.object({
  passingScore: z.number().min(0).max(100000),
});
export type UpdatePassingScoreBody = z.infer<typeof updatePassingScoreBody>;

export const startAttemptBody = z.object({
  employeeId: z.string().uuid(),
});
export type StartAttemptBody = z.infer<typeof startAttemptBody>;

export const submitAttemptBody = z.object({
  answers: z.array(z.object({
    questionId: z.string().uuid(),
    response:   z.array(z.string().min(1).max(64)),
  })).min(1),
});
export type SubmitAttemptBody = z.infer<typeof submitAttemptBody>;
