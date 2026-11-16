import { eq } from "drizzle-orm";
import { tenantProfilesEnabled, getProfile, COA_TEMPLATES, type CoaTemplate } from "@civitasone/tenant-profile";
import { financeSettings } from "../approvals/schema.js";

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
