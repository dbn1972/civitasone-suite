import { z } from "zod";

const grnItemSchema = z.object({
  poItemRef:   z.string().min(1),
  itemCode:    z.string().min(1).max(64),
  orderedQty:  z.number().int().nonnegative(),
  receivedQty: z.number().int().nonnegative(),
  acceptedQty: z.number().int().nonnegative(),
  unit:        z.string().min(1).max(32).default("nos"),
});

// DOM-002 — GRN creation is now a receive-only step: it records what was
// physically received against a PO. It carries no inspection verdict.
// Inspection (pass/fail, remarks) is a separate act performed by a distinct,
// independently authenticated actor via PATCH /grns/:id/accept or
// PATCH /grns/:id/reject — see acceptGrnBody/rejectGrnBody below. Previously
// this schema accepted an inline `inspection: { inspectorId, result,
// remarks }` object straight from the client in the SAME call as create, so
// the "inspector" was never more than whatever identity the receiver
// self-declared — not a real second, independently authenticated actor.
export const createGrnBody = z.object({
  grnNo:        z.string().min(1).max(64),
  poRef:        z.string().min(1),
  vendorId:     z.string().uuid(),
  receivedDate: z.string().optional(),
  notes:        z.string().max(500).optional(),
  items:        z.array(grnItemSchema).min(1),
});
export type CreateGrnBody = z.infer<typeof createGrnBody>;

export const idParam = z.object({ id: z.string().uuid() });

// DOM-002 — the accept (pass) verdict. Deliberately has no inspectorId
// field: the inspector's identity comes from the caller's own authenticated
// request context (ctx.actorId in commands.ts), never from the client body,
// so it cannot be spoofed.
export const acceptGrnBody = z.object({ remarks: z.string().max(500).optional() });
export type AcceptGrnBody = z.infer<typeof acceptGrnBody>;

// DOM-002 — the reject (fail) verdict. Same identity rule as accept: no
// inspectorId field, the caller's own ctx.actorId is the inspector.
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
