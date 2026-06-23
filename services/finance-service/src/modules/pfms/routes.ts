import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { assertValidAgencyCode, assertValidSchemeCode } from "../../shared/pfms.js";
import * as repo from "./repo.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

/** PFMS NEFT bank file layout (CSV) per RBI/NEFT batch conventions */
function buildBankFile(rows: Array<{ beneficiary: string; account: string; ifsc: string; amount: string; ref: string }>): string {
  const header = "Beneficiary Name,Account Number,IFSC,Amount,Payment Ref,Agency,Scheme,DDO";
  const lines = rows.map((r) =>
    [r.beneficiary, r.account, r.ifsc, r.amount, r.ref, "", "", ""].map((v) => v.includes(",") ? `"${v}"` : v).join(","),
  );
  return [header, ...lines].join("\r\n");
}

export async function pfmsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/pfms/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const cfg = await repo.getTenantConfig(ctx.tenantId);
    return reply.send(cfg ?? { agencyCode: null, defaultDdo: null });
  });

  app.get("/v1/finance/pfms/batches", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await repo.listPfmsByTenant(ctx.tenantId, 50);
    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        pfmsId: r.pfmsId,
        type: r.type,
        amountMinor: Number(r.amountMinor),
        agencyCode: r.agencyCode,
        schemeCode: r.schemeCode,
        ddoCode: r.ddoCode,
        submissionStatus: r.submissionStatus,
        signedAt: r.signedAt?.toISOString() ?? null,
      })),
    });
  });

  app.get("/v1/finance/pfms/:id/bank-file", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const batch = await repo.findPfmsById(id, ctx.tenantId);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "PFMS batch not found");
    if (batch.submissionStatus !== "signed" && batch.submissionStatus !== "pending") {
      throw new HttpError(400, "INVALID_STATE", "bank file requires signed or pending batch");
    }
    const amount = (Number(batch.amountMinor) / 100).toFixed(2);
    const csv = buildBankFile([{
      beneficiary: "Beneficiary",
      account: "000000000000",
      ifsc: "SBIN0000001",
      amount,
      ref: batch.pfmsId,
    }]);
    const filename = `pfms_${batch.pfmsId}.csv`;
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(csv);
  });

  app.post("/v1/finance/pfms/:id/sign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      certificateRef: z.string().min(1).max(256),
      signaturePayload: z.string().min(1).max(8192),
    }).parse(req.body);
    const batch = await repo.findPfmsById(id, ctx.tenantId);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "PFMS batch not found");
    const hash = createHash("sha256").update(body.signaturePayload).digest("hex");
    const sigRef = `DSC:${body.certificateRef.slice(0, 32)}:${hash.slice(0, 16)}`;
    await db.transaction(async (tx) => {
      await repo.updatePfmsBatch(tx, id, {
        signedAt: new Date(),
        signedBy: ctx.actorId,
        signatureRef: sigRef,
        bankFileHash: hash,
        submissionStatus: "signed",
        updatedBy: ctx.actorId,
      });
    });
    return reply.send({ id, signatureRef: sigRef, submissionStatus: "signed" });
  });
}

export { buildBankFile, renderTemplate };
