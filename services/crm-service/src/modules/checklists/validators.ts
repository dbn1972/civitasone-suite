/**
 * G7 zod validators for the checklist HTTP surface.
 *
 * The section/question schemas mirror the types in @civitasone/checklist. They are
 * restated in zod rather than derived because a validator's job is to refuse what the
 * wire sent, and `unknown` in a TypeScript type has to become an explicit, bounded
 * decision at the boundary (`.passthrough()` is deliberately NOT used: a template body
 * is stored verbatim as JSONB, so anything not named here would be persisted
 * unvalidated).
 */
import { z } from "zod";
import { CONDITION_OPERATORS, QUESTION_TYPES } from "@civitasone/checklist";
import { listQuery } from "../../shared/list-query.js";
import { INSTANCE_STATUSES, SUBJECT_TYPES, TEMPLATE_STATUSES } from "./schema.js";

/** Author-supplied identifiers are referenced from conditional rules, so keep them tame. */
const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/u, "must be lower-case alphanumeric with _ or -");

/**
 * A condition's right-hand side. Bounded to JSON scalars and arrays of scalars: the
 * operators only ever compare scalars or test membership, so nothing deeper is
 * meaningful, and refusing depth here keeps an arbitrarily nested object out of a
 * JSONB column that is read on every visibility evaluation.
 */
const conditionScalar = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
const conditionValue = z.union([conditionScalar, z.array(conditionScalar).max(100)]);

export const conditionalRuleSchema = z
  .object({
    dependsOn: slug,
    operator: z.enum(CONDITION_OPERATORS),
    value: conditionValue,
    action: z.enum(["show", "hide"]),
  })
  .strict();

export const questionSchema = z
  .object({
    id: slug,
    text: z.string().min(1).max(1000),
    type: z.enum(QUESTION_TYPES),
    sortOrder: z.number().int().min(0).max(10_000),
    weight: z.number().min(0).max(1000),
    required: z.boolean(),
    helpText: z.string().max(2000).optional(),
    conditionalLogic: z.array(conditionalRuleSchema).max(20).optional(),
  })
  .strict();

export const sectionSchema = z
  .object({
    id: slug,
    title: z.string().min(1).max(500),
    sortOrder: z.number().int().min(0).max(10_000),
    weight: z.number().min(0).max(1000),
    prerequisite: z
      .object({ sectionId: slug, minScore: z.number().int().min(0).max(100) })
      .strict()
      .optional(),
    questions: z.array(questionSchema).max(200),
  })
  .strict();

/** Bounded so one template cannot become an unbounded JSONB payload. */
export const sectionsSchema = z.array(sectionSchema).max(50);

export const createTemplateBody = z
  .object({
    templateKey: slug,
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    sections: sectionsSchema.default([]),
  })
  .strict();
export type CreateTemplateBody = z.infer<typeof createTemplateBody>;

export const updateTemplateBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    sections: sectionsSchema.optional(),
    version: z.number().int().min(1).optional(),
  })
  .strict()
  .refine(
    (b) => b.name !== undefined || b.description !== undefined || b.sections !== undefined,
    { message: "at least one of name, description or sections is required" },
  );
export type UpdateTemplateBody = z.infer<typeof updateTemplateBody>;

/** Publish / deprecate carry only the optimistic-locking version. */
export const templateStatusBody = z
  .object({ version: z.number().int().min(1).optional() })
  .strict()
  .default({});
export type TemplateStatusBody = z.infer<typeof templateStatusBody>;

export const listTemplatesQuery = listQuery.extend({
  templateKey: slug.optional(),
  status: z.enum(TEMPLATE_STATUSES).optional(),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuery>;

export const createInstanceBody = z
  .object({
    subjectType: z.enum(SUBJECT_TYPES),
    subjectId: z.string().uuid(),
    /** Either the exact template row, or the key whose published version should be used. */
    templateId: z.string().uuid().optional(),
    templateKey: slug.optional(),
  })
  .strict()
  .refine((b) => b.templateId !== undefined || b.templateKey !== undefined, {
    message: "one of templateId or templateKey is required",
  });
export type CreateInstanceBody = z.infer<typeof createInstanceBody>;

/**
 * A submitted answer. `value` accepts scalars and arrays of scalars — enough for every
 * question type in the engine (a `document` answer is the document id, a `signature`
 * answer is its reference) while keeping an unbounded object graph out of the column.
 */
const answerValueSchema = z.union([
  z.string().max(4000),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string().max(500), z.number(), z.boolean()])).max(200),
]);

export const submitResponsesBody = z
  .object({
    answers: z
      .array(z.object({ questionId: slug, value: answerValueSchema }).strict())
      .min(1)
      .max(500),
    version: z.number().int().min(1).optional(),
  })
  .strict();
export type SubmitResponsesBody = z.infer<typeof submitResponsesBody>;

export const listInstancesQuery = listQuery.extend({
  subjectType: z.enum(SUBJECT_TYPES).optional(),
  subjectId: z.string().uuid().optional(),
  status: z.enum(INSTANCE_STATUSES).optional(),
  templateKey: slug.optional(),
});
export type ListInstancesQuery = z.infer<typeof listInstancesQuery>;

export const idParam = z.object({ id: z.string().uuid() });
