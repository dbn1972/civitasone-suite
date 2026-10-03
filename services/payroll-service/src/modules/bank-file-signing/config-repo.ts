import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { bankFileSigningConfigSchema, DEFAULT_BANK_FILE_SIGNING, type BankFileSigningConfig } from "./types.js";

export interface StoredSigningConfig {
  config: BankFileSigningConfig;
  /** true when the tenant has no explicit setting (application default in force). */
  isDefault: boolean;
  updatedAt: string | null;
}

/** Normalise a stored jsonb value; a corrupt value fails closed (never silently "unsigned"). */
export function parseStoredConfig(raw: unknown): BankFileSigningConfig | null {
  if (raw === null || raw === undefined) return null;
  const parsed = bankFileSigningConfigSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(500, "SIGNING_CONFIG_INVALID", "the stored bank-file signing setting is invalid");
  return parsed.data;
}

export async function loadBankFileSigning(tenantId: string): Promise<StoredSigningConfig> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT bank_file_signing, updated_at FROM payroll.payroll_settings
     WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `))) as unknown as Array<{ bank_file_signing: unknown; updated_at: string }>;
  const row = rows[0];
  const stored = parseStoredConfig(row?.bank_file_signing ?? null);
  return {
    config: stored ?? DEFAULT_BANK_FILE_SIGNING,
    isDefault: stored === null,
    updatedAt: stored ? (row?.updated_at ?? null) : null,
  };
}
