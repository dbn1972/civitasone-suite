import { and, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { financePfms } from "../payments/schema.js";
import { financePfmsConfig } from "./schema.js";

export type BeneficiaryRow = {
  beneficiary: string;
  account: string;
  ifsc: string;
  amountMinor: bigint;
  ref: string;
  ddoCode: string | null;
};

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPfmsBatch(tx: Writer, row: typeof financePfms.$inferInsert): Promise<void> {
  await tx.insert(financePfms).values(row);
}

export async function findPfmsById(id: string, tenantId: string) {
  const rows = await scopedRead((tx) => tx.select().from(financePfms)
    .where(eq(financePfms.id, id))
    .limit(1));
  const row = rows[0];
  return row && row.tenantId === tenantId ? row : null;
}

/**
 * Tx-scoped variant of findPfmsById: reads through the caller's already-open
 * transaction instead of opening a nested one via scopedRead. finance.pfms.
 * batch_sign / batch_submit call this from inside their own db.transaction();
 * the scopedRead-based findPfmsById would open a second, nested transaction
 * competing for an extra pool connection while the outer one is already
 * held — under load (pool.max concurrent in-flight commands) that deadlocks.
 */
export async function findPfmsByIdTx(tx: Writer, id: string, tenantId: string) {
  const rows = await (tx as typeof db).select().from(financePfms)
    .where(eq(financePfms.id, id))
    .limit(1);
  const row = rows[0];
  return row && row.tenantId === tenantId ? row : null;
}

export async function listPfmsByTenant(tenantId: string, limit = 50) {
  return scopedRead((tx) => tx.select().from(financePfms)
    .where(eq(financePfms.tenantId, tenantId))
    .limit(limit));
}

export async function getTenantConfig(tenantId: string) {
  const rows = await scopedRead((tx) => tx.select().from(financePfmsConfig)
    .where(eq(financePfmsConfig.tenantId, tenantId))
    .limit(1));
  return rows[0] ?? null;
}

/**
 * Tx-scoped variant of getTenantConfig: reads through the caller's already-
 * open transaction instead of opening a nested one via scopedRead.
 * integrations/consumer.ts's PFMS-initiate handler calls this from inside
 * its own db.transaction() (the actual EFT-initiation path) -- see
 * findPfmsByIdTx above for the pool-exhaustion deadlock this avoids.
 */
export async function getTenantConfigTx(tx: Writer, tenantId: string) {
  const rows = await (tx as typeof db).select().from(financePfmsConfig)
    .where(eq(financePfmsConfig.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Real NEFT beneficiaries for a tenant's PFMS bank file, built from actual
 * payments.finance_payments rows (NOT a hardcoded stub):
 *   - amount        : the real payment amount_minor (PAISE bigint)
 *   - ref           : the real UTR / EFT ref (falls back to payment id)
 *   - beneficiary   : resolved vendor name via the bill's vendor_id
 *   - account       : the real bank account_no when bank_account_id is set
 *   - ddoCode       : the real payment/bill DDO
 * IFSC is not captured in finance-service's schema (no beneficiary bank master),
 * so it is emitted blank rather than fabricated — see route documentation.
 * Only releasable payments are listed (status in initiated/released/completed).
 */
export async function listRealBeneficiaries(tenantId: string, pfmsId: string, limit = 500): Promise<BeneficiaryRow[]> {
  // H1: scope strictly to the batch's own payment set (p.pfms_id = the batch's
  // pfms_id) instead of every tenant payment. Also tenant-scope the bank/bill
  // joins so a payment can never resolve another tenant's bank/bill row.
  const rows = await scopedRead((tx) => tx.execute<{
    beneficiary: string | null; account: string | null; amount_minor: string;
    ref: string; ddo_code: string | null;
  }>(sql`
    SELECT
      COALESCE(p.vendor_ref, '') AS beneficiary,
      p.bank_account_ref                   AS account,
      p.amount_minor::text                 AS amount_minor,
      COALESCE(p.utr, p.eft_ref, p.id::text) AS ref,
      COALESCE(p.ddo_code, p.ddo_code_denorm) AS ddo_code
    FROM payments.finance_payments p
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.pfms_id = ${pfmsId}
      AND p.status IN ('initiated','released','completed')
    ORDER BY p.created_at DESC
    LIMIT ${limit}
  `));
  const arr = rows as unknown as Array<{
    beneficiary: string | null; account: string | null; amount_minor: string;
    ref: string; ddo_code: string | null;
  }>;
  return arr.map((r) => ({
    beneficiary: r.beneficiary ?? "",
    account: r.account ?? "",
    ifsc: "",
    amountMinor: BigInt(r.amount_minor),
    ref: r.ref,
    ddoCode: r.ddo_code,
  }));
}

export async function updatePfmsBatch(tx: Writer, id: string, patch: Partial<typeof financePfms.$inferInsert>): Promise<void> {
  await tx.update(financePfms).set({ ...patch, updatedAt: new Date() }).where(eq(financePfms.id, id));
}

/**
 * Reconciliation bridge between the two independent PFMS submission
 * mechanisms: routes.ts's treasury batch/DSC-sign/SFTP path (this table's
 * original writer, via insertPfmsBatch/updatePfmsBatch above, always
 * channel = 'treasury_batch') and adapter-routes.ts's live e-Kuber REST
 * adapter, which used to make zero DB calls at all -- a payment submitted
 * through it left no trace discoverable via GET /v1/finance/pfms/batches,
 * the app's only PFMS status lookup. This lets the e-Kuber path write into
 * the SAME ledger (channel = 'ekuber_adapter') so that lookup answers "was
 * this disbursement actually paid" regardless of which mechanism handled it.
 *
 * Insert-or-update by (tenantId, pfmsId, channel) rather than an ON CONFLICT
 * upsert: (tenant_id, pfms_id) does have a DB-level unique constraint
 * (finance_pfms_tenant_id_pfms_id_key), but it does NOT include channel, so
 * targeting it with onConflictDoUpdate would let a caller-chosen e-Kuber
 * referenceId that happens to collide with an existing treasury batch's
 * system-generated pfmsId silently overwrite that batch's row with e-Kuber
 * fields. Filtering the SELECT by channel = 'ekuber_adapter' instead means
 * that vanishingly-rare collision instead fails the INSERT on the unique
 * constraint, which the caller (adapter-routes.ts) already treats as a
 * best-effort, log-and-swallow failure — safer than corrupting the other
 * channel's row. A tiny race window exists if the same referenceId is
 * submitted and status-checked concurrently, which the caller-supplied
 * referenceId contract (a human fills in one form, then later checks status)
 * makes very unlikely in practice.
 *
 * Best-effort by design: adapter-routes.ts wraps calls to this in try/catch
 * and never lets a local persistence failure mask or retract a real e-Kuber
 * outcome that already happened.
 */
export async function upsertAdapterPfmsRecord(params: {
  tenantId: string;
  actorId: string;
  referenceId: string;
  submissionStatus: string;
  amountMinor?: bigint;
  schemeCode?: string | null;
  ddoCode?: string | null;
  utrNumber?: string | null;
}): Promise<void> {
  const CHANNEL = "ekuber_adapter";
  await db.transaction(async (tx) => {
    const existing = await (tx as typeof db).select().from(financePfms)
      .where(and(
        eq(financePfms.tenantId, params.tenantId),
        eq(financePfms.pfmsId, params.referenceId),
        eq(financePfms.channel, CHANNEL),
      ))
      .limit(1);

    if (existing[0]) {
      await tx.update(financePfms).set({
        submissionStatus: params.submissionStatus,
        ...(params.utrNumber !== undefined ? { utrNumber: params.utrNumber } : {}),
        updatedAt: new Date(),
        updatedBy: params.actorId,
      }).where(eq(financePfms.id, existing[0].id));
      return;
    }

    await tx.insert(financePfms).values({
      tenantId: params.tenantId,
      pfmsId: params.referenceId,
      type: "adhoc",
      channel: CHANNEL,
      amountMinor: params.amountMinor ?? 0n,
      beneficiaryCount: 1,
      schemeCode: params.schemeCode ?? null,
      ddoCode: params.ddoCode ?? null,
      // submissionStatus carries e-Kuber's own disposition vocabulary
      // (accepted/rejected/processing/completed/failed/pending) —
      // finance_pfms_submission_status_check was extended for this channel
      // in migrations/0076_pfms_channel_reconciliation.sql. `status` is left
      // at its column default ('pending') deliberately: it's constrained to
      // the treasury batch's own vocabulary and no UI surfaces it for this
      // channel — submissionStatus is what GET /v1/finance/pfms/batches and
      // BatchesPanel.tsx actually show.
      submissionStatus: params.submissionStatus,
      utrNumber: params.utrNumber ?? null,
      createdBy: params.actorId,
      updatedBy: params.actorId,
    });
  });
}

/**
 * Tenant-ownership check for GET /v1/finance/pfms/payments/:ref/status.
 *
 * adapter.ts's PFMS_BASE_URL/PFMS_API_KEY are a single module-level
 * credential shared by every tenant in this deployment (see adapter.ts's
 * file header) -- the outbound e-Kuber call itself enforces no tenant
 * boundary at all. The only tenant boundary available anywhere in this path
 * is whether this exact referenceId was ever submitted/checked by this
 * tenant before, which upsertAdapterPfmsRecord has recorded (channel =
 * 'ekuber_adapter') since PR #1591. Reuses the same
 * idx_finance_pfms_tenant_pfmsid_channel index as upsertAdapterPfmsRecord's
 * own lookup (index scan, not a seq scan).
 *
 * Returns only a boolean, deliberately never the row itself: the caller
 * must not learn anything about a foreign tenant's reference beyond "this
 * is not yours" -- see adapter-routes.ts's 404 (not 403).
 */
export async function isAdapterPfmsRecordOwnedByTenant(tenantId: string, referenceId: string): Promise<boolean> {
  const CHANNEL = "ekuber_adapter";
  const rows = await scopedRead((tx) => tx.select({ id: financePfms.id }).from(financePfms)
    .where(and(
      eq(financePfms.tenantId, tenantId),
      eq(financePfms.pfmsId, referenceId),
      eq(financePfms.channel, CHANNEL),
    ))
    .limit(1));
  return rows.length > 0;
}

/**
 * Cross-tenant collision guard for POST /v1/finance/pfms/payments.
 *
 * referenceId is caller-chosen, but adapter.ts's e-Kuber credential is one
 * shared module-level singleton for the whole deployment -- referenceId is
 * therefore a single, deployment-wide namespace at the real e-Kuber end even
 * though payments.finance_pfms is keyed per-tenant. Without this guard, two
 * different tenants could each end up with their own local row for the SAME
 * referenceId, and isAdapterPfmsRecordOwnedByTenant above would then let
 * BOTH of them pass its ownership check for a referenceId e-Kuber only
 * actually recognizes as one real transaction. Rejecting a referenceId
 * another tenant already holds keeps "one referenceId, one owning tenant"
 * true, which the status-check ownership gate depends on. A resubmission by
 * the SAME tenant that already owns this referenceId is left unaffected.
 */
export async function isAdapterPfmsRecordClaimedByOtherTenant(tenantId: string, referenceId: string): Promise<boolean> {
  const CHANNEL = "ekuber_adapter";
  const rows = await scopedRead((tx) => tx.select({ tenantId: financePfms.tenantId }).from(financePfms)
    .where(and(
      eq(financePfms.pfmsId, referenceId),
      eq(financePfms.channel, CHANNEL),
    ))
    .limit(1));
  return rows.length > 0 && rows[0]!.tenantId !== tenantId;
}
