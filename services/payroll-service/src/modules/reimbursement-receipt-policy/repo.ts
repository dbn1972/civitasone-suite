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
  /** Bumped on every save; 0 = built-in default. Stamped on a claim when the API accepts it. */
  version: number;
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

type Row = { reimbursement_receipt_policy: unknown; updated_at: string; reimbursement_receipt_policy_version: number };

export async function loadReceiptPolicy(tenantId: string): Promise<StoredReceiptPolicy> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT reimbursement_receipt_policy, reimbursement_receipt_policy_version, updated_at FROM payroll.payroll_settings
     WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `))) as unknown as Row[];
  const stored = parseStoredPolicy(rows[0]?.reimbursement_receipt_policy ?? null);
  return { policy: stored, version: rows[0]?.reimbursement_receipt_policy_version ?? 0, isDefault: stored === null, updatedAt: stored ? (rows[0]?.updated_at ?? null) : null };
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

/** A stamped version older than this relative to the version that superseded it is refused (bounds a stale/forged stamp). */
export const RECEIPT_POLICY_STAMP_MAX_AGE_MS = 60 * 60 * 1000;

export type StampedPolicy =
  | { ok: true; policy: ReceiptPolicy | null; version: number }
  | { ok: false; reason: "unknown_version" | "stale_version" };

/**
 * The policy a claim was accepted under, looked up by the version the route stamped on the
 * command. Version 0 is the built-in default; the current version is the stored policy; older
 * versions come from the bounded history. A version that does not exist, or that was superseded
 * more than RECEIPT_POLICY_STAMP_MAX_AGE_MS ago, is refused.
 */
export async function loadStampedPolicyTx(
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, tenantId: string, stamped: number, now: Date = new Date(),
): Promise<StampedPolicy> {
  const rows = (await tx.execute(sql`
    SELECT reimbursement_receipt_policy, reimbursement_receipt_policy_version AS version, reimbursement_receipt_policy_history AS history
      FROM payroll.payroll_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `)) as unknown as Array<{ reimbursement_receipt_policy: unknown; version: number; history: Array<{ version: number; policy: unknown; at: string }> }>;
  const current = rows[0]?.version ?? 0;
  if (!Number.isInteger(stamped) || stamped < 0 || stamped > current) return { ok: false, reason: "unknown_version" };
  if (stamped === current) return { ok: true, policy: parseStoredPolicy(rows[0]?.reimbursement_receipt_policy ?? null), version: stamped };
  const history = rows[0]?.history ?? [];
  const mine = stamped === 0 ? null : history.find((h) => h.version === stamped);
  if (stamped !== 0 && !mine) return { ok: false, reason: "unknown_version" };
  const superseding = history.find((h) => h.version === stamped + 1);
  if (!superseding || now.getTime() - Date.parse(superseding.at) > RECEIPT_POLICY_STAMP_MAX_AGE_MS) return { ok: false, reason: "stale_version" };
  return { ok: true, policy: mine ? parseStoredPolicy(mine.policy) : null, version: stamped };
}

export async function currentPolicyVersionTx(
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, tenantId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT reimbursement_receipt_policy_version AS version FROM payroll.payroll_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `)) as unknown as Array<{ version: number }>;
  return rows[0]?.version ?? 0;
}
