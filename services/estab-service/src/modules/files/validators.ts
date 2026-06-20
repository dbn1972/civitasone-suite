import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const createFileBody = z.object({
  fileNo:         z.string().min(1),
  subject:        z.string().min(1),
  dept:           z.string().min(1),
  priority:       z.enum(["normal", "urgent", "immediate"]).default("normal"),
  classification: z.enum(["top_secret", "secret", "confidential", "public"]).default("public"),
  currentWith:    z.string().uuid(),
});
export type CreateFileBody = z.infer<typeof createFileBody>;

export const addNotingBody = z.object({
  body:      z.string().min(1),
  action:    z.string().optional(),
  officerId: z.string().uuid(),
});
export type AddNotingBody = z.infer<typeof addNotingBody>;

export const moveFileBody = z.object({
  toOfficer: z.string().uuid(),
  remarks:   z.string().optional(),
});
export type MoveFileBody = z.infer<typeof moveFileBody>;

export const closeFileBody = z.object({
  remarks: z.string().optional(),
});
export type CloseFileBody = z.infer<typeof closeFileBody>;

export const createDispatchBody = z.object({
  dispatchNo: z.string().min(1),
  fileId:     z.string().uuid().optional(),
  toAddress:  z.string().min(1),
  mode:       z.enum(["email", "post", "courier", "fax", "hand"]).default("email"),
  subject:    z.string().min(1),
});
export type CreateDispatchBody = z.infer<typeof createDispatchBody>;

export const registerInwardBody = z.object({
  dakNo:       z.string().min(1),
  fromAddress: z.string().min(1),
  subject:     z.string().min(1),
  assignedTo:  z.string().uuid().optional(),
});
export type RegisterInwardBody = z.infer<typeof registerInwardBody>;
