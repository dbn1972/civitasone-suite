import { eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsRecruitmentSettings, type RecruitmentSettingsRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * What a tenant gets when nothing has been configured: the safe maker-checker offer flow, no public identity.
 * offerWorkflowRequired MUST stay true here (and in the column default): false is what enables the deprecated
 * legacy PATCH .../offer route (UAT F85, off by default; TODO(F85-go-live): remove the route and this flag).
 */
export const DEFAULT_SETTINGS = {
  organisationName: null as string | null,
  departmentName: null as string | null,
  emblemUrl: null as string | null,
  offerWorkflowRequired: true,
  applicantPurposeNote: null as string | null,
};
export type RecruitmentSettings = typeof DEFAULT_SETTINGS;

function view(row: RecruitmentSettingsRow | undefined): RecruitmentSettings {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    organisationName: row.organisationName ?? null,
    departmentName: row.departmentName ?? null,
    emblemUrl: row.emblemUrl ?? null,
    offerWorkflowRequired: row.offerWorkflowRequired,
    applicantPurposeNote: row.applicantPurposeNote ?? null,
  };
}

export async function getSettings(tenantId: string): Promise<RecruitmentSettings> {
  return scopedRead((tx) => getSettingsTx(tx, tenantId));
}

/** Tx-scoped variant of getSettings. */
export async function getSettingsTx(tx: Writer, tenantId: string): Promise<RecruitmentSettings> {
  const rows = await (tx as typeof db).select().from(hrmsRecruitmentSettings)
    .where(eq(hrmsRecruitmentSettings.tenantId, tenantId)).limit(1);
  return view(rows[0]);
}

export async function upsertSettings(
  tx: Writer, tenantId: string, actorId: string, patch: Partial<RecruitmentSettings>,
): Promise<RecruitmentSettings> {
  const current = await getSettingsTx(tx, tenantId);
  const next = { ...current, ...patch };
  await (tx as typeof db).insert(hrmsRecruitmentSettings).values({
    tenantId, updatedBy: actorId,
    organisationName: next.organisationName, departmentName: next.departmentName, emblemUrl: next.emblemUrl,
    offerWorkflowRequired: next.offerWorkflowRequired, applicantPurposeNote: next.applicantPurposeNote,
  }).onConflictDoUpdate({
    target: hrmsRecruitmentSettings.tenantId,
    set: {
      updatedBy: actorId, updatedAt: new Date(),
      organisationName: next.organisationName, departmentName: next.departmentName, emblemUrl: next.emblemUrl,
      offerWorkflowRequired: next.offerWorkflowRequired, applicantPurposeNote: next.applicantPurposeNote,
    },
  });
  return next;
}
