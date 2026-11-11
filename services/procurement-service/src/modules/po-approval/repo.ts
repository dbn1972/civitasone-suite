/**
 * M10: persistence for the local PO approval settings (migration 0051). Writers
 * take the caller's transaction; the reader goes through scopedRead (RLS GUC).
 */
import { sql } from "drizzle-orm";
import type { DrizzleTx } from "@civitasone/outbox";
import { scopedRead } from "../../shared/db.js";
import { DEFAULT_MATRIX, type MatrixBand } from "./matrix.js";
import { isApprovalMode, type ApprovalMode } from "./mode.js";

const rowsOf = <T>(r: unknown): T[] => Array.from((r ?? []) as Iterable<T>);

type Row = { upto_minor: string | null; approver_roles: string[] };
const toBands = (rows: Row[]): MatrixBand[] => rows.map((r) => ({ upToMinor: r.upto_minor === null ? null : BigInt(r.upto_minor), approverRoles: [...r.approver_roles] }));

export type StoredMatrix = { bands: MatrixBand[]; isDefault: boolean };

/** The tenant's matrix inside the caller's transaction; the built-in default when none is stored. */
export async function loadMatrixTx(tx: DrizzleTx, tenantId: string): Promise<StoredMatrix> {
  const rows = rowsOf<Row>(await tx.execute(sql`
    SELECT upto_minor::text AS upto_minor, approver_roles FROM po.po_approval_matrix
     WHERE tenant_id = ${tenantId}::uuid ORDER BY band_no
  `));
  return rows.length === 0 ? { bands: [...DEFAULT_MATRIX], isDefault: true } : { bands: toBands(rows), isDefault: false };
}

export function loadMatrix(tenantId: string): Promise<StoredMatrix> {
  return scopedRead((tx) => loadMatrixTx(tx as unknown as DrizzleTx, tenantId));
}

export async function loadOverrideTx(tx: DrizzleTx, tenantId: string): Promise<ApprovalMode | null> {
  const rows = rowsOf<{ mode_override: string | null }>(await tx.execute(sql`
    SELECT mode_override FROM po.po_approval_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `));
  const v = rows[0]?.mode_override;
  return isApprovalMode(v) ? v : null;
}

export async function replaceMatrixTx(tx: DrizzleTx, p: { tenantId: string; actorId: string; bands: MatrixBand[] }): Promise<void> {
  await tx.execute(sql`DELETE FROM po.po_approval_matrix WHERE tenant_id = ${p.tenantId}::uuid`);
  for (const [i, b] of p.bands.entries()) {
    const roles = sql.join(b.approverRoles.map((r) => sql`${r}`), sql`, `);
    await tx.execute(sql`
      INSERT INTO po.po_approval_matrix (tenant_id, band_no, upto_minor, approver_roles, created_by, updated_by)
      VALUES (${p.tenantId}::uuid, ${i + 1}, ${b.upToMinor === null ? null : b.upToMinor.toString()}::bigint, ARRAY[${roles}]::text[], ${p.actorId}::uuid, ${p.actorId}::uuid)
    `);
  }
}

export async function setOverrideTx(tx: DrizzleTx, p: { tenantId: string; actorId: string; override: ApprovalMode | null }): Promise<void> {
  await tx.execute(sql`
    INSERT INTO po.po_approval_settings (tenant_id, mode_override, updated_by)
    VALUES (${p.tenantId}::uuid, ${p.override}, ${p.actorId}::uuid)
    ON CONFLICT (tenant_id) DO UPDATE SET mode_override = EXCLUDED.mode_override, updated_at = now(), updated_by = EXCLUDED.updated_by
  `);
}
