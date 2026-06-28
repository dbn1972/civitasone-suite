import { z } from "zod";

export const HANDOVER_REASONS = ["transfer", "leave", "retirement", "suspension"] as const;

export const createHandoverBody = z.object({
  fromOfficerId: z.string().uuid(),
  toOfficerId:   z.string().uuid(),
  reason:        z.enum(HANDOVER_REASONS).default("transfer"),
  remarks:       z.string().max(1000).optional(),
}).refine((h) => h.fromOfficerId !== h.toOfficerId, {
  message: "from and to officers must differ", path: ["toOfficerId"],
});
export type CreateHandoverBody = z.infer<typeof createHandoverBody>;

export const listHandoverQuery = z.object({
  status: z.enum(["pending", "completed"]).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
});
