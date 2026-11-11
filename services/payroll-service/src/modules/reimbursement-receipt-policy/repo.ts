import { sql } from "drizzle-orm";
import { z } from "zod";
import { REIMBURSEMENT_CATEGORY_CODES, RECEIPT_MODES, type ReceiptPolicy } from "@civitasone/types";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";

/** Shape of one category rule; cross-field rules live in receiptPolicyIssue (@civitasone/types). */
export const receiptCategoryRuleSchema = z.object({
  mode: z.enum(RECEIPT_MODES),
  thresholdMinor: z.number().int().positive().nullable().optional(),
  selfDeclarationUpToMinor: z.number().int().positive().nullable().optional(),
}).strict();

export const receiptPolicySchema = z.object({
  categories: z.record(z.enum(REIMBURSEMENT_CATEGORY_CODES), receiptCategoryRuleSchema),
}).strict();

export interface StoredReceiptPolicy {
  policy: ReceiptPolicy | null;
  /** true when the tenant has saved nothing (built-in default in force). */
  isDefault: boolean;
  updatedAt: string | null;
}

/** A corrupt stored value fails closed (500): never silently drops to "no receipt needed". */
export function parseStoredPolicy(raw: unknown): ReceiptPolicy | null {
  if (raw === null || raw === undefined) return null;
  const parsed = receiptPolicySchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(500, "RECEIPT_POLICY_INVALID", "the stored reimbursement receipt policy is invalid");
  return parsed.data as ReceiptPolicy;
}

type Row = { reimbursement_receipt_policy: unknown; updated_at: string };

export async function loadReceiptPolicy(tenantId: string): Promise<StoredReceiptPolicy> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT reimbursement_receipt_policy, updated_at FROM payroll.payroll_settings
     WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `))) as unknown as Row[];
  const stored = parseStoredPolicy(rows[0]?.reimbursement_receipt_policy ?? null);
  return { policy: stored, isDefault: stored === null, updatedAt: stored ? (rows[0]?.updated_at ?? null) : null };
}

/** Same read inside a consumer transaction (so the re-check sees the policy as of the insert). */
export async function loadReceiptPolicyTx(
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, tenantId: string,
): Promise<ReceiptPolicy | null> {
  const rows = (await tx.execute(sql`
    SELECT reimbursement_receipt_policy FROM payroll.payroll_settings
     WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `)) as unknown as Array<{ reimbursement_receipt_policy: unknown }>;
  return parseStoredPolicy(rows[0]?.reimbursement_receipt_policy ?? null);
}
