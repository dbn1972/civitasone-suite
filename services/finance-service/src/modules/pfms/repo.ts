import { and, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { decryptPii } from "../../shared/pii-crypto.js";
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
 *   - beneficiary   : resolved vendor name, via bill_id -> finance_bills.vendor_id
 *                     -> finance_vendors.name (both LEFT JOINs: bill_id is
 *                     required but vendor_id carries no FK -- see
 *                     0065_vendor_master.sql -- so an orphaned vendor_id must
 *                     not turn the whole row into an error).
 *   - account/ifsc  : the VENDOR's own payment-routing details --
 *                     finance_vendors.bank_account_no / .ifsc (both `NOT NULL`
 *                     per 0065_vendor_master.sql, so any row with a resolved
 *                     vendor always has both). This matches what
 *                     docs/user-manual/02-FINANCE.md documents for payment
 *                     initiation: "Confirm the payee's bank details (account
 *                     number, IFSC). These come from the vendor record." A
 *                     signed NEFT file must pay the VENDOR.
 *                     PRIOR BUG (fixed here, found on review of the initial
 *                     500-error fix): this used to resolve "account" via
 *                     p.bank_account_id -> treasury.finance_banks.id instead.
 *                     That FK (fk_fpayments_bank) is real, but
 *                     treasury.finance_banks holds the DEPARTMENT's own
 *                     disbursing/treasury account -- see bank-recon/repo.ts:
 *                     which of the office's OWN accounts a payment was
 *                     disbursed FROM, for bank-statement reconciliation, not
 *                     who it was paid TO. Joining it into "account" silently
 *                     printed the department's own account into a government
 *                     NEFT beneficiary file instead of the vendor's, with no
 *                     error of any kind. bank_account_id / treasury.finance_banks
 *                     are no longer joined here at all: nothing else in this
 *                     function used them, and resolving the beneficiary's own
 *                     bank details must never depend on whether a treasury
 *                     disbursing account happens to be tagged on the payment.
 *   - ddoCode       : the real payment/bill DDO
 * account_no/ifsc are `encryptedText` at rest (DPDP PII encryption,
 * pii-crypto.ts). This function reads them via a raw tx.execute(), which
 * bypasses drizzle's customType fromDriver decrypt, so both are decrypted
 * explicitly below via decryptPii() instead.
 * account/ifsc are blank (never fabricated) only when the vendor itself can't
 * be resolved at all -- an orphaned vendor_id (see beneficiary above). That's
 * the only way finance_vendors' NOT NULL bank_account_no/ifsc can still come
 * back NULL here: a LEFT JOIN finding no row, not a nullable column.
 * Only releasable payments are listed (status in initiated/released/completed).
 */
export async function listRealBeneficiaries(tenantId: string, pfmsId: string, limit = 500): Promise<BeneficiaryRow[]> {
  // H1: scope strictly to the batch's own payment set (p.pfms_id = the batch's
  // pfms_id) instead of every tenant payment. Also tenant-scope the bill/
  // vendor joins so a payment can never resolve another tenant's bill/vendor
  // row.
  const rows = await scopedRead((tx) => tx.execute<{
    beneficiary: string | null; account: string | null; ifsc: string | null; amount_minor: string;
    ref: string; ddo_code: string | null;
  }>(sql`
    SELECT
      COALESCE(v.name, '') AS beneficiary,
      v.bank_account_no                    AS account,
      v.ifsc                               AS ifsc,
      p.amount_minor::text                 AS amount_minor,
      COALESCE(p.utr, p.eft_ref, p.id::text) AS ref,
      COALESCE(p.ddo_code, p.ddo_code_denorm) AS ddo_code
    FROM payments.finance_payments p
    LEFT JOIN payments.finance_bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
    LEFT JOIN payments.finance_vendors v ON v.id = b.vendor_id AND v.tenant_id = b.tenant_id
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.pfms_id = ${pfmsId}
      AND p.status IN ('initiated','released','completed')
    ORDER BY p.created_at DESC
    LIMIT ${limit}
  `));
  const arr = rows as unknown as Array<{
    beneficiary: string | null; account: string | null; ifsc: string | null; amount_minor: string;
    ref: string; ddo_code: string | null;
  }>;
  return arr.map((r) => ({
    beneficiary: r.beneficiary ?? "",
    account: r.account ? decryptPii(r.account) : "",
    ifsc: r.ifsc ? decryptPii(r.ifsc) : "",
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
        // Fills in the real values over reserveAdapterPfmsReference's
        // placeholder (amountMinor 0n, schemeCode/ddoCode null) when this
        // update follows a reservation. Callers that never had these values
        // to begin with (the status-check route) never pass them, so these
        // keys stay undefined and nothing is overwritten there.
        ...(params.amountMinor !== undefined ? { amountMinor: params.amountMinor } : {}),
        ...(params.schemeCode !== undefined ? { schemeCode: params.schemeCode } : {}),
        ...(params.ddoCode !== undefined ? { ddoCode: params.ddoCode } : {}),
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
 * Mirrors the isUniqueViolation idiom used in masters/repo.ts (and, per that
 * file's own doc comment, court-service's config-registry/repo.ts and
 * cause-list/repo.ts) rather than importing it across modules for one small,
 * dependency-free helper.
 */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code;
  return code === "23505" || code === "23P01";
}

export class AdapterPfmsReferenceClaimedError extends Error {
  constructor(referenceId: string) {
    super(`referenceId ${referenceId} is already in use`);
    this.name = "AdapterPfmsReferenceClaimedError";
  }
}

/**
 * Cross-tenant collision guard for POST /v1/finance/pfms/payments -- REPLACES
 * a previous isAdapterPfmsRecordClaimedByOtherTenant that looked for an
 * existing row via a plain cross-tenant SELECT. That approach was
 * STRUCTURALLY BROKEN and has been removed: payments.finance_pfms has FORCE
 * ROW LEVEL SECURITY with a tenant_isolation policy USING (tenant_id =
 * budget.current_tenant_id()) (migrations/0020_rls_completion.sql), which
 * finance-service's own connection sets from the request's tenant on every
 * db.transaction()/scopedRead() call (see shared/db.ts's scopedRead doc
 * comment). That policy applies to SELECT unconditionally, including a query
 * that deliberately omits its own tenant filter to look across tenants --
 * Postgres silently re-adds "tenant_id = current_tenant_id()" underneath ANY
 * select against this table, regardless of what WHERE clause the caller
 * wrote. So the old function could never see another tenant's row (0 rows
 * returned cross-tenant vs. 1 same-tenant, confirmed against the real
 * NOBYPASSRLS finance_svc role -- a test role created via a plain
 * `POSTGRES_USER` Docker env var is a cluster SUPERUSER, which unconditionally
 * BYPASSES RLS and will hide this bug; verifying this requires a role created
 * the same way infra/db/bootstrap/bootstrap.generated.sql creates finance_svc
 * -- a plain CREATE ROLE ... LOGIN, no BYPASSRLS).
 *
 * RLS does NOT, however, protect a UNIQUE INDEX from enforcing across rows a
 * role can't see via SELECT: a uniqueness violation is raised at the index
 * level against the physical index when a conflicting row is inserted, not
 * through a policy-filtered read. migrations/
 * 0078_pfms_adapter_reference_uniqueness.sql adds a partial unique index on
 * pfms_id WHERE channel = 'ekuber_adapter' -- global across every tenant for
 * this channel (referenceId really is a single, deployment-wide namespace at
 * the shared e-Kuber account -- see adapter.ts's file header), unlike the
 * existing (tenant_id, pfms_id, channel) index, which is per-tenant. This
 * function relies on that constraint: it INSERTs a placeholder row for
 * referenceId and translates the resulting 23505 unique-violation (another
 * tenant already holds it) into AdapterPfmsReferenceClaimedError.
 *
 * Callers MUST first confirm (via isAdapterPfmsRecordOwnedByTenant) that the
 * CALLING tenant does not already own this referenceId before calling this --
 * the unique index doesn't distinguish "same tenant, resubmission" from
 * "different tenant, collision", so calling this for a reference the caller's
 * own tenant already owns would incorrectly reject a legitimate resubmission.
 *
 * Callers MUST call this and handle AdapterPfmsReferenceClaimedError as 409
 * BEFORE calling e-Kuber's submitPayment: a collision detected only after a
 * real e-Kuber submission would mean a duplicate/ambiguous real financial
 * transaction already went through against the shared credential, which is
 * strictly worse than the cross-tenant read this whole fix exists to close.
 */
export async function reserveAdapterPfmsReference(params: {
  tenantId: string;
  actorId: string;
  referenceId: string;
}): Promise<void> {
  const CHANNEL = "ekuber_adapter";
  try {
    await db.transaction(async (tx) => {
      await (tx as typeof db).insert(financePfms).values({
        tenantId: params.tenantId,
        pfmsId: params.referenceId,
        type: "adhoc",
        channel: CHANNEL,
        amountMinor: 0n,
        beneficiaryCount: 1,
        submissionStatus: "pending",
        createdBy: params.actorId,
        updatedBy: params.actorId,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AdapterPfmsReferenceClaimedError(params.referenceId);
    }
    throw err;
  }
}

/**
 * Best-effort cleanup for a reservation made by reserveAdapterPfmsReference
 * when the real e-Kuber submitPayment call that was supposed to follow it
 * then failed -- so a failed submission still leaves no trace in the ledger,
 * matching this route's pre-existing behavior for failures (and the "was
 * this disbursement actually paid" ledger's whole purpose -- a perpetually
 * "pending" row for a submission that never actually reached e-Kuber would
 * be misleading). Deliberately scoped to (tenantId, referenceId, channel,
 * submissionStatus='pending') so it can only ever delete the CALLER's own
 * just-created, still-pending reservation -- never another tenant's row, and
 * never a row that has since progressed past "pending" (e.g. a concurrent
 * status check already updated it).
 */
export async function releaseAdapterPfmsReservation(tenantId: string, referenceId: string): Promise<void> {
  const CHANNEL = "ekuber_adapter";
  await db.transaction(async (tx) => {
    await (tx as typeof db).delete(financePfms).where(and(
      eq(financePfms.tenantId, tenantId),
      eq(financePfms.pfmsId, referenceId),
      eq(financePfms.channel, CHANNEL),
      eq(financePfms.submissionStatus, "pending"),
    ));
  });
}
