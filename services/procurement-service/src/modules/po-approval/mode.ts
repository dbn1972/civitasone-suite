/**
 * M10: how a procurement tenant's purchase orders are approved.
 *
 *   finance_sanction -- today's path, unchanged: a PO above Rs 1,000 must cite a
 *                       finance budget sanction (checked against finance-service)
 *                       and is approved through its workflow task.
 *   local            -- for a tenant WITHOUT the Finance module: no sanction is
 *                       asked for and finance-service is never called; a PO is
 *                       approved by a procurement approver whose role the
 *                       threshold matrix allows for its value, never by its maker.
 *
 * Derived from whether the tenant has Finance; po.po_approval_settings.mode_override
 * forces it either way. Every current tenant has Finance and no override, so every
 * current tenant resolves to "finance_sanction".
 */
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { scopedRead } from "../../shared/db.js";
import { tenantHasModule } from "../../shared/tenant-modules.js";

const log = pino({ name: "procurement-approval-mode" });

export type ApprovalMode = "finance_sanction" | "local";
export type ApprovalModeSource = "override" | "derived";

export const isApprovalMode = (v: unknown): v is ApprovalMode => v === "finance_sanction" || v === "local";

/** Pure: the override when valid, else finance_sanction iff the tenant has Finance. */
export function effectiveApprovalMode(override: string | null | undefined, hasFinance: boolean): { mode: ApprovalMode; source: ApprovalModeSource } {
  if (isApprovalMode(override)) return { mode: override, source: "override" };
  return { mode: hasFinance ? "finance_sanction" : "local", source: "derived" };
}

/**
 * Run outside any transaction (a settings read and, without an override, an admin-service lookup).
 * A settings read that fails counts as "no override", and an unknown Finance answer counts as "has Finance",
 * so a hiccup can only leave a tenant on today's sanction path, never move one onto local approval.
 */
export async function resolveApprovalModeDetail(tenantId: string): Promise<{ mode: ApprovalMode; source: ApprovalModeSource; override: ApprovalMode | null; hasFinance: boolean | null }> {
  let override: ApprovalMode | null = null;
  try {
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT mode_override FROM po.po_approval_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1
    `))) as unknown as Array<{ mode_override: string | null }> | undefined;
    const v = rows?.[0]?.mode_override;
    override = isApprovalMode(v) ? v : null;
  } catch (err) {
    log.warn({ tenantId, err: err instanceof Error ? err.message : String(err) }, "approval mode: settings read failed, treating as no override");
  }
  const hasFinance = override ? null : await tenantHasModule(tenantId, "finance");
  const { mode, source } = effectiveApprovalMode(override, hasFinance ?? true);
  return { mode, source, override, hasFinance };
}

export async function resolveApprovalMode(tenantId: string): Promise<ApprovalMode> {
  return (await resolveApprovalModeDetail(tenantId)).mode;
}
