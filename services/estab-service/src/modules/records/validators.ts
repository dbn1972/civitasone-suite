import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const assignCategoryBody = z.object({
  category:       z.enum(["A", "B", "C", "D", "E"]),
  disposalAction: z.string().min(1).optional(),
});
export type AssignCategoryBody = z.infer<typeof assignCategoryBody>;

export const recordDisposalBody = z.object({
  disposalAction: z.string().min(1),
});
export type RecordDisposalBody = z.infer<typeof recordDisposalBody>;

export const proposeWeedoutBody = z.object({
  fileId: z.string().uuid(),
  reason: z.string().min(1).optional(),
});
export type ProposeWeedoutBody = z.infer<typeof proposeWeedoutBody>;

export const rejectWeedoutBody = z.object({
  reason: z.string().min(1).optional(),
});
export type RejectWeedoutBody = z.infer<typeof rejectWeedoutBody>;

export const destroyWeedoutBody = z.object({
  destructionCertRef: z.string().min(1),
});
export type DestroyWeedoutBody = z.infer<typeof destroyWeedoutBody>;

export const listWeedoutQuery = z.object({
  status: z.enum(["proposed", "approved", "rejected", "destroyed"]).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
});
export type ListWeedoutQuery = z.infer<typeof listWeedoutQuery>;
