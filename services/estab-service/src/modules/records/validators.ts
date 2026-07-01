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


// ── R4 record-room management ────────────────────────────────────────────

export const transferToRecordRoomBody = z.object({
  recordRoomId: z.string().min(1).optional(),
  rack:         z.string().min(1).optional(),
  shelf:        z.string().min(1).optional(),
  bundleNo:     z.string().min(1).optional(),
});
export type TransferToRecordRoomBody = z.infer<typeof transferToRecordRoomBody>;

export const requisitionRecordBody = z.object({
  fileId:  z.string().uuid(),
  purpose: z.string().min(1).optional(),
  dueBack: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RequisitionRecordBody = z.infer<typeof requisitionRecordBody>;

export const returnRecordBody = z.object({
  requisitionId: z.string().uuid(),
});
export type ReturnRecordBody = z.infer<typeof returnRecordBody>;

export const listRequisitionsQuery = z.object({
  status: z.enum(["issued", "returned"]).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
});
export type ListRequisitionsQuery = z.infer<typeof listRequisitionsQuery>;


// ── R5 archival & NAI ────────────────────────────────────────────────────

export const archiveFileBody = z.object({
  remarks: z.string().min(1).optional(),
});
export type ArchiveFileBody = z.infer<typeof archiveFileBody>;

export const recordNaiTransferBody = z.object({
  naiReference: z.string().min(1),
  registerNo:   z.string().min(1).optional(),
  remarks:      z.string().min(1).optional(),
});
export type RecordNaiTransferBody = z.infer<typeof recordNaiTransferBody>;


// ── R6 Records Officer + annual review ───────────────────────────────────

export const appointRecordsOfficerBody = z.object({
  operatorId: z.string().uuid(),
  orgUnitId:  z.string().uuid().optional(),
});
export type AppointRecordsOfficerBody = z.infer<typeof appointRecordsOfficerBody>;

export const recordAnnualReviewBody = z.object({
  fileId:   z.string().uuid(),
  decision: z.enum(["retain", "weed", "archive"]),
  remarks:  z.string().min(1).optional(),
  nextReviewDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RecordAnnualReviewBody = z.infer<typeof recordAnnualReviewBody>;
