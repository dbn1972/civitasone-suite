import { and, eq, sql } from "drizzle-orm";
import { tenantProfilesEnabled, getProfile, effectiveSettings, LEGACY_SETTINGS, COA_TEMPLATES, type CoaTemplate, type ProfileSettings } from "@civitasone/tenant-profile";
import { randomUUID } from "node:crypto";
import { financeSettings } from "../approvals/schema.js";
import { setFundAccountingTx } from "./fund-activation.js";

type SettingsReader = {
  select: (cols: { coaTemplate: typeof financeSettings.coaTemplate; profileCode: typeof financeSettings.profileCode }) => {
    from: (t: typeof financeSettings) => { where: (c: unknown) => { limit: (n: number) => Promise<Array<{ coaTemplate: string; profileCode: string }>> } };
  };
};

/**
 * Tenant-profile S4: which chart-of-accounts template (and COA packs) a tenant's heads are seeded from.
 *
 * The #1 safety property: with TENANT_PROFILES_ENABLED off, with no gl.finance_settings row (onboarding can run before the
 * settings are written), or with coa_template = govt, this returns { template: "govt", packs: [] } and seedGlHeadsTx
 * writes rows byte-identical to the pre-S4 seed. With the flag off NO query is made. An unknown stored value also reads
 * as govt (never loosens anything). Must run in a transaction scoped to `tenantId` (RLS).
 */
export async function resolveCoaTemplateTx(tx: unknown, tenantId: string): Promise<{ template: CoaTemplate; packs: readonly string[] }> {
  if (!tenantProfilesEnabled()) return { template: "govt", packs: [] };
  const rows = await (tx as SettingsReader)
    .select({ coaTemplate: financeSettings.coaTemplate, profileCode: financeSettings.profileCode })
    .from(financeSettings).where(eq(financeSettings.tenantId, tenantId)).limit(1);
  const stored = rows[0]?.coaTemplate;
  const template = (COA_TEMPLATES as readonly string[]).includes(stored ?? "") ? (stored as CoaTemplate) : "govt";
  // Packs ride on the stored profile (govt_small_office -> office-pack); only a govt chart can carry one.
  const packs = template === "govt" ? [...(getProfile(rows[0]?.profileCode)?.settings.coaPacks ?? [])] : [];
  return { template, packs };
}

/**
 * The gl.finance_settings columns a profile materialises at onboard, or null when the profile resolves to LEGACY_SETTINGS
 * (flag off, unknown/placeholder profile, govt_dept) -- in which case NO row is written and onboarding is exactly what it
 * was before. The one edition->settings mapping point here is the tenant-profile catalogue (effectiveSettings); nothing
 * is hard-coded. Pure.
 */
export function profileFinanceSettings(profileCode: string | null | undefined, flagOn: boolean = tenantProfilesEnabled()):
  { profileCode: string; settings: ProfileSettings } | null {
  const p = getProfile(profileCode);
  if (!flagOn || !p) return null;
  const settings = effectiveSettings(p.code, true);
  const legacy = settings.coaTemplate === LEGACY_SETTINGS.coaTemplate && settings.accountingBasis === LEGACY_SETTINGS.accountingBasis
    && settings.budgetControl === LEGACY_SETTINGS.budgetControl && settings.coaPacks.length === 0;
  return legacy ? null : { profileCode: p.code, settings };
}

/**
 * Tenant-profile finance activation: at tenant.onboarded, write the tenant's INITIAL gl.finance_settings (coa_template,
 * accounting_basis, budget_control, profile_code; fund_accounting via setFundAccountingTx when the profile sets it) from its profile, in the SAME transaction that then resolves the template
 * and seeds the heads -- so the seed sees the row (no ordering race) and a non-govt tenant gets its own chart.
 *
 *  - Flag off, or a profile that resolves to LEGACY (govt_dept): returns false and touches nothing (no query, no write).
 *  - Never overwrites a tenant's settings: ON CONFLICT updates ONLY a row that is still pristine (version 1 and every
 *    profile column at its default), so a redelivery or a row that maker-checker already changed is left alone.
 *  - coa_template stays non-API-settable; later changes still go through the approvals maker-checker path.
 */
export async function activateFinanceProfileTx(tx: unknown, tenantId: string, profileCode: string | null | undefined, actorId: string, correlationId: string = randomUUID()): Promise<boolean> {
  const want = profileFinanceSettings(profileCode);
  if (!want) return false;
  const { settings: s } = want;
  const values = { accountingBasis: s.accountingBasis, budgetControl: s.budgetControl, coaTemplate: s.coaTemplate, profileCode: want.profileCode };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tx as any;
  const applied = await t.insert(financeSettings).values({ tenantId, ...values, updatedBy: actorId })
    .onConflictDoUpdate({
      target: financeSettings.tenantId,
      set: { ...values, updatedBy: actorId, updatedAt: new Date(), version: sql`${financeSettings.version} + 1` },
      setWhere: and(
        eq(financeSettings.version, 1), eq(financeSettings.coaTemplate, "govt"), eq(financeSettings.accountingBasis, "cash"),
        eq(financeSettings.budgetControl, "mandatory"), eq(financeSettings.profileCode, "govt_dept"),
      ),
    }).returning({ tenantId: financeSettings.tenantId });
  // Fund accounting (Section 8): never a raw column write (DB trigger gl.guard_fund_accounting_flip). Only when THIS call
  // applied the pristine row (a redelivery, or a row maker-checker already changed, returns no row and is left alone), and
  // through the one guarded path, which also creates the GENERAL fund in this same transaction.
  if (s.fundAccounting && applied.length > 0) {
    await setFundAccountingTx(t, { tenantId, actorId, correlationId }, true, `tenant profile ${want.profileCode} onboard`);
  }
  return true;
}
