import { z } from "zod";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// transferBody is the shared shape consumed by employee/commands.ts
// (employeeId comes from the URL there) — DO NOT add employeeId here.
export const transferBody = z.object({
  fromDeptId:    z.string().uuid(),
  toDeptId:      z.string().uuid(),
  fromDesigId:   z.string().uuid().optional(),
  toDesigId:     z.string().uuid().optional(),
  effectiveDate: DATE,
  orderRef:      z.string().max(128).optional(),
  // HIGH fix: a transfer to a new department can imply a different pay
  // scale/structure. There is no automatic department->pay-structure
  // derivation anywhere in this codebase (payStructureId is caller-supplied
  // at hire time too -- see employee/commands.ts's createEmployee), so this
  // mirrors that same caller-supplied pattern rather than inventing a new
  // one: optional, like toDesigId, and applied by the consumer only when
  // given (a transfer that doesn't change pay-structure omits it).
  payStructureId: z.string().uuid().optional(),
});
export type TransferBody = z.infer<typeof transferBody>;

// Lifecycle transfer-order creation carries employeeId + stations in the body.
export const createTransferBody = transferBody.extend({
  employeeId:  z.string().uuid(),
  fromStation: z.string().max(128).optional(),
  toStation:   z.string().max(128).optional(),
});
export type CreateTransferBody = z.infer<typeof createTransferBody>;

// GAP-HR-TRANSFER-02: the order number is the department's own order-register
// number, typed by the issuing officer (it becomes the service-book documentRef).
// Letters, digits and the separators order registers use (/ . - _); no spaces or
// other punctuation so it is safe to print, search and compare.
export const ORDER_NO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,63}$/;

export const issueOrderBody = z.object({
  orderNo:   z.string().trim().regex(ORDER_NO_PATTERN, "order number may contain letters, digits and / . - _ only (max 64)"),
  orderDate: DATE,
  orderRef:  z.string().max(128).optional(),
});
export const relieveBody = z.object({ relievedDate: DATE });
export const joinBody = z.object({ joinedDate: DATE });

export const separateBody = z.object({
  separationType: z.enum(["resignation", "retirement", "termination", "vrs", "death"]),
  effectiveDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastWorkingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  encashmentDays:  z.number().int().nonnegative().default(0),
  remarks:         z.string().max(1000).optional(),
});
export type SeparateBody = z.infer<typeof separateBody>;

export const idParam = z.object({ id: z.string().uuid() });

// Promotion creation — validated (replaces prior raw body casts in routes.ts).
export const createPromotionBody = z.object({
  employeeId:    z.string().uuid(),
  fromDesigId:   z.string().uuid(),
  toDesigId:     z.string().uuid(),
  effectiveDate: DATE,
  orderRef:      z.string().max(128).optional(),
  newBasicMinor: z.number().int().positive().max(1_000_000_00).optional(),
});
export type CreatePromotionBody = z.infer<typeof createPromotionBody>;

// promotionBody is the shared shape consumed by employee/commands.ts
// (employeeId comes from the URL there) — DO NOT add employeeId here. Mirrors
// transferBody for the eOffice submit-for-approval loop.
// GAP-HR-RETIREMENT-01: one toggle per call, matching the wizard's
// checkbox-at-a-time UX and giving each toggle its own audit row. The
// 5 steps x 5 checks (25 total) shape matches the wizard's own STEPS
// constant (RetirementProcessWizard.tsx) exactly -- tightened to this
// canonical set (not an open range) so a completeness check can safely
// count "done" rows without also having to verify which slots exist.
export const checklistToggleBody = z.object({
  stepId: z.enum(["1", "2", "3", "4", "5"]),
  checkIndex: z.number().int().min(0).max(4),
  done: z.boolean(),
});
export type ChecklistToggleBody = z.infer<typeof checklistToggleBody>;
export const TOTAL_CHECKLIST_ITEMS = 25;

export const promotionBody = z.object({
  fromDesigId:   z.string().uuid(),
  toDesigId:     z.string().uuid(),
  effectiveDate: DATE,
  orderRef:      z.string().max(128).optional(),
  newBasicMinor: z.number().int().positive().max(1_000_000_00).optional(),
});
export type PromotionBody = z.infer<typeof promotionBody>;
