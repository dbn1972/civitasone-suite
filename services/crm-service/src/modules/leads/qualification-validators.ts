/** LQ-001 zod validators — qualification frameworks, questions, and qualify submit. */
import { z } from "zod";

export const answerTypeEnum = z.enum(["bool", "select", "number"]);

/** A question as supplied on framework create/update. */
export const questionInput = z.object({
  prompt: z.string().min(1).max(400),
  answerType: answerTypeEnum.default("bool"),
  weight: z.number().int().min(0).max(100).default(0),
  // Interpreted by qualification-domain per answerType. Bounded object; free-form
  // by design (option maps / tier ladders vary per tenant).
  outcomeRule: z.record(z.unknown()).default({}),
  order: z.number().int().min(0).max(1000).default(0),
});
export type QuestionInput = z.infer<typeof questionInput>;

export const createFrameworkBody = z.object({
  name: z.string().min(1).max(160),
  businessLine: z.string().max(64).optional(),
  active: z.boolean().optional(),
  questions: z.array(questionInput).max(50).optional(),
});
export type CreateFrameworkBody = z.infer<typeof createFrameworkBody>;

export const updateFrameworkBody = z.object({
  name: z.string().min(1).max(160).optional(),
  businessLine: z.string().max(64).nullable().optional(),
  active: z.boolean().optional(),
  // When present, REPLACES the framework's question set wholesale.
  questions: z.array(questionInput).max(50).optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field is required" });
export type UpdateFrameworkBody = z.infer<typeof updateFrameworkBody>;

export const listFrameworksQuery = z.object({
  businessLine: z.string().max(64).optional(),
  active: z.coerce.boolean().optional(),
});

/** Answers keyed by question id; value is bool | string | number. */
export const qualifyBody = z.object({
  frameworkId: z.string().uuid(),
  answers: z.record(z.union([z.boolean(), z.string(), z.number()])).default({}),
});
export type QualifyBody = z.infer<typeof qualifyBody>;

export const frameworkIdParam = z.object({ id: z.string().uuid() });
export const leadIdParam = z.object({ id: z.string().uuid() });
