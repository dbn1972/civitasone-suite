/**
 * G13 Resolution Playbooks — zod schemas. Every route boundary parses through
 * one of these before anything is published to the queue.
 */
import { z } from "zod";

/** Kept in step with domain.PLAYBOOK_STEP_TYPES (asserted by a unit test). */
export const stepTypeSchema = z.enum(["instruction", "task", "knowledge_link", "form", "escalate"]);

export const playbookStepSchema = z.object({
  id: z.string().min(1).max(64),
  ordinal: z.coerce.number().int().min(1).max(500),
  type: stepTypeSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  mandatory: z.boolean().default(false),
  slaOffsetMinutes: z.coerce.number().int().min(0).max(525_600).nullable().default(null),
  knowledgeArticleId: z.string().uuid().nullable().default(null),
});

/** Nullable matching criteria — null/omitted means "matches anything". */
const criteriaShape = {
  categoryId: z.string().uuid().nullable().optional(),
  productCode: z.string().min(1).max(64).nullable().optional(),
  ticketType: z.string().min(1).max(24).nullable().optional(),
  priority: z.string().min(1).max(24).nullable().optional(),
};

export const createPlaybookBody = z.object({
  playbookKey: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, "playbookKey must be lower-case alphanumeric with . _ -"),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  versionNumber: z.coerce.number().int().min(1).max(9999).optional(),
  steps: z.array(playbookStepSchema).min(1).max(200),
  ...criteriaShape,
});
export type CreatePlaybookBody = z.infer<typeof createPlaybookBody>;

export const updatePlaybookBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    steps: z.array(playbookStepSchema).min(1).max(200).optional(),
    /** Optimistic locking — when supplied, must equal the stored `version`. */
    expectedVersion: z.coerce.number().int().min(1).optional(),
    ...criteriaShape,
  })
  .refine(
    (b) => Object.keys(b).filter((k) => k !== "expectedVersion").length > 0,
    { message: "at least one field required" },
  );
export type UpdatePlaybookBody = z.infer<typeof updatePlaybookBody>;

/** publish / deprecate carry only the optimistic-locking guard. */
export const lifecycleBody = z
  .object({ expectedVersion: z.coerce.number().int().min(1).optional() })
  .default({});
export type LifecycleBody = z.infer<typeof lifecycleBody>;

export const listPlaybooksQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["draft", "published", "deprecated"]).optional(),
  playbookKey: z.string().min(1).max(128).optional(),
});
export type ListPlaybooksQuery = z.infer<typeof listPlaybooksQuery>;

/**
 * GET /v1/helpdesk/playbooks/resolve query. All four dimensions optional; an
 * omitted dimension means the ticket has no value there, so only playbooks that
 * leave it unconstrained can match.
 */
export const resolveQuery = z.object({
  categoryId: z.string().uuid().optional(),
  productCode: z.string().min(1).max(64).optional(),
  ticketType: z.string().min(1).max(24).optional(),
  priority: z.string().min(1).max(24).optional(),
});
export type ResolveQuery = z.infer<typeof resolveQuery>;

export const startRunBody = z.object({
  ticketId: z.string().uuid(),
  /** Omit to auto-resolve the best-matching published playbook for the ticket. */
  playbookId: z.string().uuid().optional(),
});
export type StartRunBody = z.infer<typeof startRunBody>;

export const completeStepBody = z
  .object({ note: z.string().max(2000).nullable().optional() })
  .default({});
export type CompleteStepBody = z.infer<typeof completeStepBody>;

export const completeRunBody = z
  .object({ expectedVersion: z.coerce.number().int().min(1).optional() })
  .default({});
export type CompleteRunBody = z.infer<typeof completeRunBody>;

export const idParam = z.object({ id: z.string().uuid() });
export const runStepParams = z.object({
  id: z.string().uuid(),
  stepId: z.string().min(1).max(64),
});
