import { z } from "zod";

export const formFieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  type: z.enum(["text", "textarea", "number", "select", "boolean"]),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
});

export const fulfilmentStageSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  assigneeRole: z.string().max(128).nullable().optional(),
});

const priority = z.enum(["Low", "Medium", "High", "Critical"]);

export const createOfferingBody = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(128).optional(),
  description: z.string().max(4000).optional(),
  slaPolicyId: z.string().uuid().nullable().optional(),
  approvalRequired: z.boolean().optional(),
  requestFormSchema: z.array(formFieldSchema).optional(),
  fulfilmentStages: z.array(fulfilmentStageSchema).optional(),
  defaultPriority: priority.optional(),
});
export type CreateOfferingBody = z.infer<typeof createOfferingBody>;

export const updateOfferingBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    category: z.string().min(1).max(128).optional(),
    description: z.string().max(4000).nullable().optional(),
    slaPolicyId: z.string().uuid().nullable().optional(),
    approvalRequired: z.boolean().optional(),
    requestFormSchema: z.array(formFieldSchema).optional(),
    fulfilmentStages: z.array(fulfilmentStageSchema).optional(),
    defaultPriority: priority.optional(),
    status: z.enum(["active", "retired"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });
export type UpdateOfferingBody = z.infer<typeof updateOfferingBody>;

export const createOlaBody = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["ola", "uc"]).optional(),
  provider: z.string().min(1).max(200),
  targetMinutes: z.coerce.number().int().min(1),
});
export type CreateOlaBody = z.infer<typeof createOlaBody>;

export const raiseRequestBody = z.object({
  formData: z.record(z.unknown()).optional(),
  priority: priority.optional(),
});
export type RaiseRequestBody = z.infer<typeof raiseRequestBody>;

export const approvalBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().max(2000).optional(),
});
export type ApprovalBody = z.infer<typeof approvalBody>;

export const advanceStageBody = z.object({
  toStage: z.string().min(1).max(64),
  note: z.string().max(2000).optional(),
});
export type AdvanceStageBody = z.infer<typeof advanceStageBody>;

export const fulfilRequestBody = z.object({
  note: z.string().max(2000).optional(),
});
export type FulfilRequestBody = z.infer<typeof fulfilRequestBody>;

export const idParam = z.object({ id: z.string().uuid() });
