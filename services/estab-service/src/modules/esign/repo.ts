import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabSignConfig, estabSignature, type SignConfigRow, type SignatureRow, type SignatureInsert } from "./schema.js";
import type { SignConfig, SignMethod, SignMode } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

const DEFAULT_CONFIG: SignConfig = { mode: "disabled", allowedMethods: ["aadhaar_esign", "dsc"] };

function toConfig(row: SignConfigRow | undefined): SignConfig {
  if (!row) return DEFAULT_CONFIG;
  return { mode: row.mode as SignMode, allowedMethods: (row.allowedMethods ?? []) as SignMethod[] };
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function getSignConfig(tenantId: string): Promise<SignConfig> {
  const rows = await db.transaction((tx) => tx.select().from(estabSignConfig).where(eq(estabSignConfig.tenantId, tenantId)).limit(1));
  return toConfig(rows[0]);
}

export async function getSignConfigTx(tx: Writer, tenantId: string): Promise<SignConfig> {
  const rows = await (tx as typeof db).select().from(estabSignConfig).where(eq(estabSignConfig.tenantId, tenantId)).limit(1);
  return toConfig(rows[0]);
}

export async function upsertSignConfig(tx: Writer, tenantId: string, mode: SignMode, allowedMethods: SignMethod[], updatedBy: string): Promise<void> {
  await (tx as typeof db).execute(sql`
    INSERT INTO files.estab_sign_config (tenant_id, mode, allowed_methods, updated_by, updated_at)
    VALUES (${tenantId}::uuid, ${mode}, ${JSON.stringify(allowedMethods)}::jsonb, ${updatedBy}::uuid, now())
    ON CONFLICT (tenant_id) DO UPDATE SET
      mode = EXCLUDED.mode, allowed_methods = EXCLUDED.allowed_methods,
      updated_by = EXCLUDED.updated_by, updated_at = now()
  `);
}

export async function insertSignature(tx: Writer, row: SignatureInsert): Promise<void> {
  await tx.insert(estabSignature).values(row);
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listSignatures(tenantId: string, subjectType: string, subjectId: string): Promise<SignatureRow[]> {
  return db.transaction((tx) => tx.select().from(estabSignature).where(and(
    eq(estabSignature.tenantId, tenantId),
    eq(estabSignature.subjectType, subjectType),
    eq(estabSignature.subjectId, subjectId),
  )));
}

/** True when the subject has at least one VALID signature (tenant-scoped, in-tx). */
export async function hasValidSignatureTx(tx: Writer, tenantId: string, subjectType: string, subjectId: string): Promise<boolean> {
  const rows = await (tx as typeof db).select({ id: estabSignature.id }).from(estabSignature).where(and(
    eq(estabSignature.tenantId, tenantId),
    eq(estabSignature.subjectType, subjectType),
    eq(estabSignature.subjectId, subjectId),
    eq(estabSignature.valid, true),
  )).limit(1);
  return rows.length > 0;
}
