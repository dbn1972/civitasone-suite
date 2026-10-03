import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { loadBankFileSigning } from "./config-repo.js";
import * as commands from "./commands.js";
import { isProductionFor } from "./environment.js";
import { getSigningKeyProvider } from "./key-provider.js";
import { assertUnsignedAllowed } from "./service.js";
import { bankFileSigningConfigSchema, SIGNING_FORMATS, signatureContentType } from "./types.js";

/** Reading the policy / the file list: any payroll operator. Changing it: admin only. */
const READ_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const ADMIN_ROLES = ["payroll_admin", "super_admin"];

const updateBodySchema = bankFileSigningConfigSchema.extend({
  /** Recorded on the audit event; the web ConfirmDialog always sends it (min 10 chars). */
  reason: z.string().trim().min(10).max(500).optional(),
}).superRefine((b, ctx) => {
  const formats = [b.format, ...Object.values(b.perBankOverrides ?? {})];
  if (b.encryptToBank && formats.includes("none")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["encryptToBank"], message: "encrypt-to-bank requires a signed format (no 'none')" });
  }
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  runId: z.string().uuid().optional(),
});
const idParamSchema = z.object({ id: z.string().uuid() });

type IssuanceListRow = {
  id: string; run_id: string; seq: number; mode: string; file_format: string; file_name: string;
  line_count: number; total_minor: string; created_at: string;
  signature_format: string | null; file_sha256: string | null; signed_at: string | null;
  signing_key_fingerprint: string | null; encrypted_to_bank: boolean; has_signature: boolean;
  run_no: string | null; month: string | null;
};

export async function bankFileSigningRoutes(app: FastifyInstance): Promise<void> {
  /** The tenant's signing policy + key status. Never returns key material. */
  app.get("/v1/payroll/bank-file-signing", async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const stored = await loadBankFileSigning(ctx.tenantId);
    const provider = getSigningKeyProvider();
    const key = await provider.status(stored.config.keyRef);
    const production = await isProductionFor(ctx.tenantId);
    return {
      config: {
        format: stored.config.format,
        perBankOverrides: stored.config.perBankOverrides ?? {},
        encryptToBank: stored.config.encryptToBank,
        keyRef: stored.config.keyRef,
      },
      isDefault: stored.isDefault,
      updatedAt: stored.updatedAt,
      formats: SIGNING_FORMATS,
      production,
      unsignedAllowed: !production,
      key,
    };
  });

  /** Change the policy (admin only). CQRS: publishes a command; the consumer writes + audits. */
  app.put("/v1/payroll/bank-file-signing", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = updateBodySchema.parse(req.body);
    await assertUnsignedAllowed(ctx.tenantId, body);
    const { reason, ...config } = body;
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateBankFileSigning(ctx, {
      format: config.format,
      perBankOverrides: config.perBankOverrides,
      encryptToBank: config.encryptToBank,
      keyRef: config.keyRef,
      reason: reason ?? null,
    }));
  });

  /** Issued bank files, newest first, with signed/unsigned state. */
  app.get("/v1/payroll/disbursement/files", async (req, reply) => {
    void reply.header("cache-control", "no-store");
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuerySchema.parse(req.query);
    const runFilter = q.runId ? sql`AND f.run_id = ${q.runId}::uuid` : sql``;
    const { rows, total } = await scopedRead(async (tx) => {
      const r = (await tx.execute(sql`
        SELECT f.id, f.run_id, f.seq, f.mode, f.file_format, f.file_name, f.line_count,
               f.total_minor::text AS total_minor, f.created_at, f.signature_format, f.file_sha256,
               f.signed_at, f.signing_key_fingerprint, f.encrypted_to_bank,
               (f.signature IS NOT NULL) AS has_signature, pr.run_no, pr.month
          FROM payroll.disbursement_file_issuances f
          LEFT JOIN payroll.payroll_runs pr ON pr.id = f.run_id AND pr.tenant_id = f.tenant_id
         WHERE f.tenant_id = ${ctx.tenantId}::uuid ${runFilter}
         ORDER BY f.created_at DESC, f.id DESC
         LIMIT ${q.limit} OFFSET ${q.offset}
      `)) as unknown as IssuanceListRow[];
      const c = (await tx.execute(sql`
        SELECT COUNT(*)::int AS n FROM payroll.disbursement_file_issuances f
         WHERE f.tenant_id = ${ctx.tenantId}::uuid ${runFilter}
      `)) as unknown as Array<{ n: number }>;
      return { rows: r, total: c[0]?.n ?? 0 };
    });
    return {
      data: rows.map((f) => ({
        id: f.id,
        runId: f.run_id,
        runNo: f.run_no,
        month: f.month,
        seq: f.seq,
        mode: f.mode,
        fileFormat: f.file_format,
        fileName: f.file_name,
        lineCount: f.line_count,
        totalMinor: f.total_minor,
        createdAt: f.created_at,
        // NULL = issued before signing existed -> reported as the explicit "none".
        signatureFormat: f.signature_format ?? "none",
        signed: f.signature_format !== null && f.signature_format !== "none",
        hasDetachedSignature: f.has_signature,
        fileSha256: f.file_sha256,
        signedAt: f.signed_at,
        signingKeyFingerprint: f.signing_key_fingerprint,
        encryptedToBank: f.encrypted_to_bank,
      })),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  });

  /** The detached signature (.sig armoured text / .p7s DER) of an issued file. */
  app.get("/v1/payroll/disbursement/files/:id/signature", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParamSchema.parse(req.params);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT file_name, signature_format, signature, file_sha256
        FROM payroll.disbursement_file_issuances
       WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1
    `))) as unknown as Array<{ file_name: string; signature_format: string | null; signature: string | null; file_sha256: string | null }>;
    const row = rows[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "bank file not found");
    if (!row.signature || (row.signature_format !== "pgp_detached" && row.signature_format !== "pkcs7_detached")) {
      throw new HttpError(404, "NO_DETACHED_SIGNATURE", "this bank file has no detached signature (unsigned, or the signature is embedded in the file)");
    }
    const isPgp = row.signature_format === "pgp_detached";
    const name = `${row.file_name}.${isPgp ? "sig" : "p7s"}`;
    return reply
      .header("cache-control", "no-store")
      .header("content-type", signatureContentType(row.signature_format) ?? "application/octet-stream")
      .header("content-disposition", `attachment; filename="${name}"`)
      .header("x-bank-file-signature-format", row.signature_format)
      .header("x-bank-file-sha256", row.file_sha256 ?? "")
      .send(isPgp ? row.signature : Buffer.from(row.signature, "base64"));
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof z.ZodError) {
      void reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
