import { sql } from "drizzle-orm";
import { scoped } from "./_tenant.js";

export type SettingsPatch = {
  makerCheckerEnabled?: boolean;
  blockFyActivationOpenPeriods?: boolean;
  requireOpeningBalancesForActivation?: boolean;
  fyCreateAsDraft?: boolean;
};

/**
 * Upsert gl.finance_settings for a test tenant. Tests of the DIRECT (single
 * officer) paths pass `{ makerCheckerEnabled: false }`; tenants with no row get
 * the production defaults (second approver on, open periods block activation).
 */
export async function setFinanceSettings(tenantId: string, patch: SettingsPatch): Promise<void> {
  const v = {
    maker: patch.makerCheckerEnabled ?? true,
    block: patch.blockFyActivationOpenPeriods ?? true,
    ob: patch.requireOpeningBalancesForActivation ?? false,
    draft: patch.fyCreateAsDraft ?? true,
  };
  await scoped(tenantId, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_settings (tenant_id, maker_checker_enabled, block_fy_activation_open_periods,
      require_opening_balances_for_activation, fy_create_as_draft, updated_by)
    VALUES (${tenantId}::uuid, ${v.maker}, ${v.block}, ${v.ob}, ${v.draft}, ${tenantId}::uuid)
    ON CONFLICT (tenant_id) DO UPDATE SET maker_checker_enabled = EXCLUDED.maker_checker_enabled,
      block_fy_activation_open_periods = EXCLUDED.block_fy_activation_open_periods,
      require_opening_balances_for_activation = EXCLUDED.require_opening_balances_for_activation,
      fy_create_as_draft = EXCLUDED.fy_create_as_draft`));
}

export async function clearFinanceSettings(tenantId: string): Promise<void> {
  await scoped(tenantId, (tx) => tx.execute(sql`DELETE FROM gl.finance_settings WHERE tenant_id = ${tenantId}::uuid`));
  await scoped(tenantId, (tx) => tx.execute(sql`DELETE FROM gl.finance_change_requests WHERE tenant_id = ${tenantId}::uuid`));
}

/** Configure the three debt GL heads for a test tenant (the register has no defaults). */
export async function setDebtHeads(tenantId: string, heads: { loan: string | null; interest: string | null; bank: string | null }): Promise<void> {
  await setFinanceSettings(tenantId, {});
  await scoped(tenantId, (tx) => tx.execute(sql`
    UPDATE gl.finance_settings SET debt_loan_liability_head_id = ${heads.loan}::uuid,
      debt_interest_expense_head_id = ${heads.interest}::uuid, debt_bank_head_id = ${heads.bank}::uuid
    WHERE tenant_id = ${tenantId}::uuid`));
}
