import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { getPfmsTreasuryMode } from "./pfms-client.js";
import { isEnabled as isPaymentRailEnabled } from "./adapter.js";
import { fetchUserNames } from "../../shared/identity-client.js";
import { readSettings } from "../approvals/repo.js";
import { isProductionDeployment } from "./dsc-client.js";
import { SENT_STATES, checkDistinct, checkReleasable } from "./release.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];
/** Releasing a signed batch to PFMS moves money: admins only (a narrower set than signing). */
const RELEASE_ROLES = ["finance_admin", "super_admin"];

/**
 * GAP-FINANCE-PFMS-03: the NEFT bank file carries beneficiary account numbers,
 * IFSC and amounts (DPDP-sensitive). Every download must state why, and the
 * reason is written to the audit trail with the actor, batch and request origin.
 */
const bankFileQuery = z.object({
  reason: z.string().trim().min(3, "state why the bank file is being downloaded").max(500),
});

/** Format PAISE bigint as a rupees.decimals string without Number() precision loss. */
function rupeesFromPaise(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const rupees = abs / 100n;
  const paisePart = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${rupees.toString()}.${paisePart}`;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

/** PFMS NEFT bank file layout (CSV) per RBI/NEFT batch conventions */
function buildBankFile(rows: Array<{
  beneficiary: string; account: string; ifsc: string; amount: string; ref: string;
  agency?: string; scheme?: string; ddo?: string;
}>): string {
  const header = "Beneficiary Name,Account Number,IFSC,Amount,Payment Ref,Agency,Scheme,DDO";
  // H2: CSV / formula-injection defence. A cell whose first char is one of
  // = + - @ TAB CR is interpreted as a formula by spreadsheet apps; prefix it
  // with a single quote to neutralise it, then apply normal CSV quoting.
  const csvCell = (v: string): string => {
    const neutralised = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(neutralised)
      ? `"${neutralised.replace(/"/g, '""')}"`
      : neutralised;
  };
  const lines = rows.map((r) =>
    [r.beneficiary, r.account, r.ifsc, r.amount, r.ref, r.agency ?? "", r.scheme ?? "", r.ddo ?? ""]
      .map(csvCell).join(","),
  );
  return [header, ...lines].join("\r\n");
}

/** Vendor display names — same resolution used by payments queries. */
const VENDOR_NAMES: Record<string, string> = {
  "eeeeeeee-0001-0000-0000-000000000001": "M/s Bharat Construction Pvt. Ltd.",
  "eeeeeeee-0001-0000-0000-000000000002": "Infosys BPM Government Solutions",
  "eeeeeeee-0001-0000-0000-000000000003": "TCIL Infrastructure Ltd.",
  "eeeeeeee-0001-0000-0000-000000000004": "BEML Limited",
};

export async function pfmsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/pfms/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const cfg = await repo.getTenantConfig(ctx.tenantId);
    // GAP-FINANCE-PFMS-05: two DIFFERENT integrations are gated by two different
    // env families, so they are reported separately and never merged:
    //  - paymentRail: the e-Kuber adapter behind POST /v1/finance/pfms/payments
    //    (adapter.ts: PFMS_ENABLED / PFMS_BASE_URL / PFMS_API_KEY). It has NO
    //    sandbox: it either pays for real ("live") or returns 503 ("disabled").
    //  - treasuryMode: the treasury client behind salary-bill / payment-advice
    //    (pfms-client.ts: PFMS_TREASURY_*), which does have a simulated "sandbox".
    // No credentials are exposed, only the derived state.
    return reply.send({
      ...(cfg ?? { agencyCode: null, defaultDdo: null }),
      paymentRail: isPaymentRailEnabled() ? "live" : "disabled",
      treasuryMode: getPfmsTreasuryMode(),
    });
  });

  app.get("/v1/finance/pfms/batches", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await repo.listPfmsByTenant(ctx.tenantId, 50);
    // Names, never raw ids, for who signed (fail-open: an unreachable identity-service just yields no name).
    const names = await fetchUserNames(ctx.tenantId, rows.map((r) => r.signedBy).filter((v): v is string => !!v));
    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        pfmsId: r.pfmsId,
        type: r.type,
        // Reconciliation: which PFMS mechanism produced this row —
        // 'treasury_batch' (this route's own batch/DSC-sign/SFTP path) or
        // 'ekuber_adapter' (adapter-routes.ts's live REST path, unified into
        // this same table/lookup — see migrations/0076b_pfms_channel_reconciliation.sql).
        channel: r.channel,
        // M1: emit paise as an exact decimal string (no Number() precision loss
        // on aggregate paise > 2^53).
        amountMinor: r.amountMinor.toString(),
        agencyCode: r.agencyCode,
        schemeCode: r.schemeCode,
        ddoCode: r.ddoCode,
        submissionStatus: r.submissionStatus,
        utrNumber: r.utrNumber,
        signedAt: r.signedAt?.toISOString() ?? null,
        // GAP-FINANCE-PFMS-01: signing status + certificate info. The signature value itself is never listed.
        signing: {
          status: r.dscSignature ? "signed" : r.signedAt ? "signed_legacy" : "unsigned",
          signedAt: r.signedAt?.toISOString() ?? null,
          signedByName: r.signedBy ? names.get(r.signedBy) ?? null : null,
          certificateSerial: r.dscCertSerial,
          algorithm: r.dscAlgorithm,
          signerRef: r.dscSignerRef,
          providerKey: r.dscProviderKey,
          environment: r.dscEnvironment,
          mock: r.dscSignature ? r.dscMock : null,
          batchDigest: r.batchDigest,
          verifiedAt: r.dscVerifiedAt?.toISOString() ?? null,
        },
        // Release bookkeeping: when an in-flight / ambiguous release started and why the last attempt failed.
        release: {
          startedAt: r.releaseStartedAt?.toISOString() ?? null,
          lastFailureCode: r.lastReleaseFailureCode,
          lastFailureAt: r.lastReleaseFailureAt?.toISOString() ?? null,
        },
      })),
    });
  });

  app.get("/v1/finance/pfms/:id/bank-file", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = bankFileQuery.parse(req.query);
    const batch = await repo.findPfmsById(id, ctx.tenantId);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "PFMS batch not found");
    // A row from the e-Kuber adapter channel (adapter-routes.ts) is a
    // completed synchronous REST submission, not a treasury batch — it has
    // no beneficiary set in finance_payments and nothing to put in a bank
    // file. Now that both channels share this table (see migrations/
    // 0076b_pfms_channel_reconciliation.sql), guard explicitly instead of
    // silently emitting a header-only CSV.
    if (batch.channel !== "treasury_batch") {
      throw new HttpError(400, "INVALID_CHANNEL", "bank file is only applicable to treasury batch submissions");
    }
    if (batch.submissionStatus !== "signed" && batch.submissionStatus !== "pending") {
      throw new HttpError(400, "INVALID_STATE", "bank file requires signed or pending batch");
    }
    // Production hands out the bank file only for a batch that carries a DSC signature (a pending, unsigned batch has none).
    if (isProductionDeployment() && !batch.dscSignature) {
      throw new HttpError(409, "UNSIGNED_BATCH", "the bank file is available only after the batch is DSC-signed");
    }
    // P1-4: build the NEFT advice from REAL finance_payments beneficiaries
    // (real amount / account / ref / DDO), not a hardcoded stub. Account/IFSC
    // are the VENDOR's own payment-routing details (finance_vendors.
    // bank_account_no/.ifsc, resolved by repo.ts's listRealBeneficiaries) --
    // blank only when the payment's bill/vendor can't be resolved at all
    // (orphaned vendor_id), never fabricated and never the department's own
    // treasury account.
    const beneficiaries = await repo.listRealBeneficiaries(ctx.tenantId, batch.pfmsId);
    const rows = beneficiaries.map((b) => ({
      beneficiary: VENDOR_NAMES[b.beneficiary] ?? (b.beneficiary || "Unknown beneficiary"),
      account: b.account,
      ifsc: b.ifsc,
      amount: rupeesFromPaise(b.amountMinor),
      ref: b.ref,
      agency: batch.agencyCode ?? "",
      scheme: batch.schemeCode ?? "",
      ddo: b.ddoCode ?? batch.ddoCode ?? "",
    }));
    const csv = buildBankFile(rows);
    const filename = `pfms_${batch.pfmsId}.csv`;
    // Audit the successful generation (actor, batch, stated reason, origin) in
    // the same outbox the rest of the service uses. Written BEFORE the file is
    // sent: if the audit write fails, the file is not released.
    await commands.recordBankFileExport(ctx, {
      batchId: batch.id, pfmsId: batch.pfmsId, reason, beneficiaryCount: rows.length,
      ipAddress: req.ip,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
    });
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(csv);
  });

  app.post("/v1/finance/pfms/:id/sign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // GAP-FINANCE-PFMS-01: the signature is produced by the tenant's DSC signer, never pasted in. A client that still
    // sends certificateRef / signaturePayload is refused (strict) rather than having them silently ignored.
    const body = z.object({ reason: z.string().trim().min(3).max(200).optional() }).strict().parse(req.body ?? {});
    const batch = await repo.findPfmsById(id, ctx.tenantId);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "PFMS batch not found");
    // See the same guard in GET /:id/bank-file above — DSC-signing is a
    // treasury batch concept; an e-Kuber adapter row is already a completed
    // (accepted/rejected) synchronous submission with nothing to sign.
    if (batch.channel !== "treasury_batch") {
      throw new HttpError(400, "INVALID_CHANNEL", "signing is only applicable to treasury batch submissions");
    }
    // Read-only pre-checks for an immediate answer; the consumer re-checks with a guarded update (authoritative).
    if (batch.submissionStatus === "signed") {
      return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted" as const, correlationId: ctx.correlationId });
    }
    if (batch.submissionStatus !== "pending") {
      throw new HttpError(409, "INVALID_STATE", `a batch that is ${batch.submissionStatus} cannot be signed`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.signBatch(ctx, id, body));
  });

  /**
   * Release a signed batch to PFMS (GAP-FINANCE-PFMS-01). Folds the old submit step in: one command verifies the stored
   * signature, enforces the production gate and maker-checker, sends the NACH file through the EFT-initiate path and moves
   * the batch signed -> file_sent with a guarded update. Read-only pre-checks give an immediate refusal; the consumer
   * re-checks authoritatively. An already-sent batch is accepted and audited as a no-op.
   */
  app.post("/v1/finance/pfms/batches/:id/release", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RELEASE_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const batch = await repo.findPfmsById(id, ctx.tenantId);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "PFMS batch not found");
    if (!(SENT_STATES as readonly string[]).includes(batch.submissionStatus)) {
      const settings = await readSettings(ctx.tenantId);
      const check = await checkReleasable(batch, ctx.actorId, settings.makerCheckerEnabled);
      if (!check.ok) throw new HttpError(check.status, check.code, check.message);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.releaseBatch(ctx, id));
  });

  /**
   * Resolve a release whose outcome is unknown (send_unknown): the operator checked the PFMS gateway and confirms the file
   * was sent (-> file_sent) or was NOT sent (-> signed, may be released again). Reason required; maker != checker against
   * whoever started the release when the tenant setting is on. Route -> command -> consumer; audited.
   */
  app.post("/v1/finance/pfms/batches/:id/resolve-release", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RELEASE_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ outcome: z.enum(["sent", "not_sent"]), reason: z.string().trim().min(5).max(500) }).strict().parse(req.body ?? {});
    const batch = await repo.findPfmsById(id, ctx.tenantId);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "PFMS batch not found");
    if (batch.submissionStatus !== "send_unknown") {
      throw new HttpError(409, "INVALID_STATE", `only a release with an unknown outcome can be resolved (this batch is ${batch.submissionStatus})`);
    }
    const settings = await readSettings(ctx.tenantId);
    const d = checkDistinct(settings.makerCheckerEnabled, batch.releasedBy, ctx.actorId, "the user who started this release cannot also resolve it");
    if (!d.ok) throw new HttpError(d.status, d.code, d.message);
    return sendAccepted(reply, acceptedResponseSchema, await commands.resolveRelease(ctx, id, body));
  });

  /**
   * Void the signature of a signed, unsent batch (typically one that changed after signing) so it can be signed again.
   * Reason required; maker != checker against whoever signed when the tenant setting is on; audited with the voided cert.
   */
  app.post("/v1/finance/pfms/batches/:id/void-signature", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RELEASE_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().trim().min(5).max(500) }).strict().parse(req.body ?? {});
    const batch = await repo.findPfmsById(id, ctx.tenantId);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "PFMS batch not found");
    if (batch.channel !== "treasury_batch") throw new HttpError(400, "INVALID_CHANNEL", "only treasury batches carry a DSC signature");
    if (batch.submissionStatus !== "signed") {
      throw new HttpError(409, "INVALID_STATE", `only a signed, unsent batch can have its signature voided (this batch is ${batch.submissionStatus})`);
    }
    const settings = await readSettings(ctx.tenantId);
    const d = checkDistinct(settings.makerCheckerEnabled, batch.signedBy, ctx.actorId, "the user who signed this batch cannot also void its signature");
    if (!d.ok) throw new HttpError(d.status, d.code, d.message);
    return sendAccepted(reply, acceptedResponseSchema, await commands.voidSignature(ctx, id, body));
  });

  // A malformed body / query is a 400 VALIDATION_FAILED (not a 500), same handler as the sibling finance modules.
  app.setErrorHandler(financeErrorHandler);
}

export { buildBankFile, renderTemplate };
