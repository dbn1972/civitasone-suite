import { z } from "zod";

export const createInstallmentsBody = z.object({
  installments: z.array(z.object({
    installmentNo: z.number().int().positive(),
    amountMinor:   z.number().int().positive(),
    condition:     z.string().optional(),
    dueDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })).min(1),
  currency: z.string().length(3).default("INR"),
});
export type CreateInstallmentsBody = z.infer<typeof createInstallmentsBody>;

export const disburseBody = z.object({
  mode:               z.enum(["PFMS", "DBT", "cheque", "RTGS"]).default("PFMS"),
  beneficiaryBankRef: z.string().optional(),
  // R14: when true, the disbursement is created and held in `pending_approval`
  // WITHOUT paying; the eOffice approval emits the single EFT (approval before
  // payment). Default false preserves the legacy immediate-pay behaviour.
  requireApproval:    z.boolean().optional().default(false),
});
export type DisburseBody = z.infer<typeof disburseBody>;

export const pfmsReconcileBody = z.object({
  records: z.array(z.object({
    pfmsTxnId:   z.string().min(1),
    status:      z.enum(["completed", "failed"]),
    rawResponse: z.string().optional(),
  })).min(1),
});
export type PfmsReconcileBody = z.infer<typeof pfmsReconcileBody>;

export const idParam    = z.object({ id: z.string().uuid() });
export const appIdQuery = z.object({ appId: z.string().uuid().optional() });
