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

export type PendingOverride = { mode: "local"; requestedBy: string; requestedAt: string };

export async function loadPendingTx(tx: DrizzleTx, tenantId: string): Promise<PendingOverride | null> {
  const rows = rowsOf<{ pending_mode_override: string | null; pending_requested_by: string | null; pending_requested_at: string | null }>(await tx.execute(sql`
    SELECT pending_mode_override, pending_requested_by::text AS pending_requested_by, pending_requested_at::text AS pending_requested_at
      FROM po.po_approval_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `));
  const r = rows[0];
  return r?.pending_mode_override === "local" && r.pending_requested_by ? { mode: "local", requestedBy: r.pending_requested_by, requestedAt: r.pending_requested_at ?? "" } : null;
}

export function loadPending(tenantId: string): Promise<PendingOverride | null> {
  return scopedRead((tx) => loadPendingTx(tx as unknown as DrizzleTx, tenantId));
}

/** Record (or refresh) a request to force local approval; the effective mode does not change. */
export async function setPendingTx(tx: DrizzleTx, p: { tenantId: string; actorId: string }): Promise<void> {
  await tx.execute(sql`
    INSERT INTO po.po_approval_settings (tenant_id, mode_override, pending_mode_override, pending_requested_by, pending_requested_at, updated_by)
    VALUES (${p.tenantId}::uuid, NULL, 'local', ${p.actorId}::uuid, now(), ${p.actorId}::uuid)
    ON CONFLICT (tenant_id) DO UPDATE SET pending_mode_override = 'local', pending_requested_by = EXCLUDED.pending_requested_by,
      pending_requested_at = now(), updated_at = now(), updated_by = EXCLUDED.updated_by
  `);
}

export async function clearPendingTx(tx: DrizzleTx, tenantId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE po.po_approval_settings SET pending_mode_override = NULL, pending_requested_by = NULL, pending_requested_at = NULL
     WHERE tenant_id = ${tenantId}::uuid AND pending_mode_override IS NOT NULL
  `);
}
