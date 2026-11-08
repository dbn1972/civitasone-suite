import { z } from "zod";
import { zTrimmedText, zTrimmedCode, zIsoDate, DATE_WINDOWS, istToday, yearsFromEnv, fieldIssue, FIELD_CODES } from "@civitasone/schemas/validators";

/** GRN received date: never in the future, at most GRN_RECEIVED_MAX_PAST_YEARS (default 1) back (TE-01 G01, TE-07 G02/G03). */
export const grnReceivedWindow = () => DATE_WINDOWS.happened(istToday(), yearsFromEnv("GRN_RECEIVED_MAX_PAST_YEARS", 1));

const grnItemSchema = z.object({
  poItemRef:   zTrimmedText(128, { label: "PO line" }),
  itemCode:    zTrimmedCode(64, "item code"),
  orderedQty:  z.number().int().nonnegative(),
  receivedQty: z.number().int().nonnegative().max(1_000_000_000),
  acceptedQty: z.number().int().nonnegative().max(1_000_000_000),
  unit:        zTrimmedText(32, { label: "unit" }).default("nos"),
}).superRefine((v, ctx) => {
  // UAT T-EDGE TE-04 (G05): accepted more than received was 202-accepted and then
  // dead-lettered by the worker (assertQtyValid). Refused here, on the field.
  if (v.acceptedQty > v.receivedQty) {
    fieldIssue(ctx, FIELD_CODES.ACCEPTED_EXCEEDS_RECEIVED, `accepted quantity ${v.acceptedQty} is more than the received quantity ${v.receivedQty}`, ["acceptedQty"]);
  }
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
  // GAP-PROCUREMENT-GRN-NEW-01 — grnNo is issued server-side from a gapless
  // per-tenant per-year sequence (allocateDocNo in grn/consumer.ts); any value
  // the client sends is ignored. Kept optional only for backward compatibility
  // with older callers that still include it.
  grnNo:        z.string().max(64).optional(),
  poRef:        z.string().min(1),
  vendorId:     z.string().uuid(),
  receivedDate: zIsoDate({ window: grnReceivedWindow, label: "received date" }).optional(),
  notes:        z.string().max(500).optional(),
  // UAT b10 F95: the inventory store the goods are received into. Carried on procurement.grn.accepted so
  // inventory-service can post the stock receipt (it has no other way to know the store).
  storeId:      z.string().uuid().optional(),
  items:        z.array(grnItemSchema).min(1),
});
export type CreateGrnBody = z.infer<typeof createGrnBody>;

export const idParam = z.object({ id: z.string().uuid() });

// DOM-002 — the accept (pass) verdict. Deliberately has no inspectorId
// field: the inspector's identity comes from the caller's own authenticated
// request context (ctx.actorId in commands.ts), never from the client body,
// so it cannot be spoofed.
export const acceptGrnBody = z.object({
  remarks: z.string().max(500).optional(),
  // UAT b10 F95: the receiving inventory store, for a GRN that was created without one.
  storeId: z.string().uuid().optional(),
});
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
