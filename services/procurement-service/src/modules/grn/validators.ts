import { z } from "zod";

const grnItemSchema = z.object({
  poItemRef:   z.string().min(1),
  itemCode:    z.string().min(1).max(64),
  orderedQty:  z.number().int().nonnegative(),
  receivedQty: z.number().int().nonnegative(),
  acceptedQty: z.number().int().nonnegative(),
  unit:        z.string().min(1).max(32).default("nos"),
});

export const createGrnBody = z.object({
  grnNo:        z.string().min(1).max(64),
  poRef:        z.string().min(1),
  vendorId:     z.string().uuid(),
  receivedDate: z.string().optional(),
  notes:        z.string().max(500).optional(),
  items:        z.array(grnItemSchema).min(1),
  inspection: z.object({
    inspectorId: z.string().uuid(),
    result:      z.enum(["pending", "pass", "fail"]),
    remarks:     z.string().max(500).optional(),
  }),
});
export type CreateGrnBody = z.infer<typeof createGrnBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const rejectGrnBody = z.object({ reason: z.string().min(1).max(500) });
export type RejectGrnBody = z.infer<typeof rejectGrnBody>;

// Req 1.2 — GRN partial-delivery amendment. Only line quantities change;
// grnNo, vendorId, and poRef are immutable and are not accepted here.
const amendGrnLineSchema = z.object({
  lineId:      z.string().uuid(),
  receivedQty: z.number().int().nonnegative(),
  acceptedQty: z.number().int().nonnegative(),
});

export const amendGrnBody = z.object({
  lines: z.array(amendGrnLineSchema).min(1),
});
export type AmendGrnBody = z.infer<typeof amendGrnBody>;
