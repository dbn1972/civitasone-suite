import { z } from "zod";

export const COMMUNICATION_TYPES = [
  "letter", "order", "memo", "notification", "circular", "do_letter",
] as const;

export const createDfaBody = z.object({
  fileId:             z.string().uuid().nullable().default(null),
  communicationType:  z.enum(COMMUNICATION_TYPES).default("letter"),
  templateCode:       z.string().min(1).optional(),
  subject:            z.string().min(3).max(500),
  body:               z.string().min(1),
  recipientEmployeeId: z.string().uuid().nullable().default(null),
  recipientName:      z.string().min(1).optional(),
  recipientAddress:   z.string().min(1).optional(),
});
export type CreateDfaBody = z.infer<typeof createDfaBody>;

export const updateDfaBody = z.object({
  communicationType:  z.enum(COMMUNICATION_TYPES).optional(),
  templateCode:       z.string().min(1).optional(),
  subject:            z.string().min(3).max(500).optional(),
  body:               z.string().min(1).optional(),
  recipientEmployeeId: z.string().uuid().nullable().optional(),
  recipientName:      z.string().min(1).optional(),
  recipientAddress:   z.string().min(1).optional(),
});
export type UpdateDfaBody = z.infer<typeof updateDfaBody>;

export const returnDfaBody = z.object({
  reason: z.string().min(3).max(1000),
});

export const dispatchDfaBody = z.object({
  mode:      z.enum(["email", "post", "courier", "hand", "epost"]).default("email"),
  toAddress: z.string().min(1).optional(),
});

export const listDfaQuery = z.object({
  status: z.enum(["draft", "pending_approval", "approved", "returned", "signed", "dispatched"]).optional(),
  fileId: z.string().uuid().optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
});
