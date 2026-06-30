import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const createFileBody = z.object({
  fileNo:         z.string().min(1).optional(),
  section:        z.string().min(1).optional(),
  subject:        z.string().min(1),
  dept:           z.string().min(1),
  priority:       z.enum(["normal", "urgent", "immediate"]).default("normal"),
  classification: z.enum(["top_secret", "secret", "confidential", "public"]).default("public"),
  currentWith:    z.string().uuid(),
  initialNote:    z.string().optional(),
  inwardId:       z.string().uuid().optional(),
  dakNo:          z.string().optional(),
  parentFileId:   z.string().uuid().optional(),
});
export type CreateFileBody = z.infer<typeof createFileBody>;

export const addNotingBody = z.object({
  body:      z.string().min(1),
  action:    z.string().optional(),
  officerId: z.string().uuid(),
  officerName:        z.string().optional(),
  officerDesignation: z.string().optional(),
  officerSection:     z.string().optional(),
  noteType:  z.enum(["yellow", "green", "remark", "order"]).default("yellow"),
});
export type AddNotingBody = z.infer<typeof addNotingBody>;

export const submitNotingBody = z.object({
  notingId: z.string().uuid(),
});
export type SubmitNotingBody = z.infer<typeof submitNotingBody>;

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
  dispatchNo: z.string().min(1).optional(), // system-generated when omitted (CSMOP gapless)
  fileId:     z.string().uuid().optional(),
  toAddress:  z.string().min(1),
  mode:       z.enum(["email", "post", "courier", "fax", "hand"]).default("email"),
  subject:    z.string().min(1),
});
export type CreateDispatchBody = z.infer<typeof createDispatchBody>;

export const registerInwardBody = z.object({
  dakNo:         z.string().min(1),
  fromAddress:   z.string().min(1),
  subject:       z.string().min(1),
  assignedTo:    z.string().uuid().optional(),
  sourceSection: z.string().optional(),
  mode:          z.enum(["post", "email", "fax", "hand", "portal", "courier"]).optional(),
  language:      z.string().max(24).optional(),
  urgency:       z.enum(["normal", "urgent", "immediate"]).optional(),
  category:      z.string().max(32).optional(),
  receivedDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RegisterInwardBody = z.infer<typeof registerInwardBody>;

/** Attach an already-diarised receipt to an EXISTING file (CSMOP). */
export const attachInwardBody = z.object({
  inwardId: z.string().uuid(),
});
export type AttachInwardBody = z.infer<typeof attachInwardBody>;

/** Detach a wrongly-attached receipt — reason is mandatory and audited. */
export const detachInwardBody = z.object({
  inwardId: z.string().uuid(),
  reason:   z.string().min(3).max(500),
});
export type DetachInwardBody = z.infer<typeof detachInwardBody>;

export const recallFileBody = z.object({
  remarks: z.string().optional(),
});
export type RecallFileBody = z.infer<typeof recallFileBody>;

export const reopenFileBody = z.object({
  reason: z.string().min(3).max(500),
});
export type ReopenFileBody = z.infer<typeof reopenFileBody>;

export const deliveryUpdateBody = z.object({
  dispatchId:    z.string().uuid(),
  deliveryStatus: z.enum(["sent", "delivered", "returned", "failed"]),
  deliveryProof: z.string().optional(),
});
export type DeliveryUpdateBody = z.infer<typeof deliveryUpdateBody>;

export const addAttachmentBody = z.object({
  fileName:   z.string().min(1),
  fileType:   z.string().default("application/pdf"),
  sizeBytes:  z.number().int().nonnegative().default(0),
  storageRef: z.string().optional(),
  contentBase64: z.string().optional(),
});
export type AddAttachmentBody = z.infer<typeof addAttachmentBody>;

export const openFileFromInwardBody = z.object({
  dept:           z.string().min(1),
  currentWith:    z.string().uuid(),
  classification: z.enum(["top_secret", "secret", "confidential", "public"]).default("public"),
  initialNote:    z.string().optional(),
});
export type OpenFileFromInwardBody = z.infer<typeof openFileFromInwardBody>;
