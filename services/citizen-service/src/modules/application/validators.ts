import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const citizenIdQuery = z.object({ citizenId: z.string().uuid() });

export const submitApplicationBody = z.object({
  citizenId: z.string().uuid(),
  serviceId: z.string().uuid(),
  serviceType: z.string().min(1),
  documentTypes: z.array(z.string().min(1)).default([]),
});
export type SubmitApplicationBody = z.infer<typeof submitApplicationBody>;

export const statusUpdateBody = z.object({
  status: z.enum(["submitted", "under_review", "pending_docs", "approved", "rejected", "issued"]),
  note:   z.string().optional(),
});
export type StatusUpdateBody = z.infer<typeof statusUpdateBody>;

export const docUploadBody = z.object({
  docType: z.string().min(1),
});
export type DocUploadBody = z.infer<typeof docUploadBody>;
