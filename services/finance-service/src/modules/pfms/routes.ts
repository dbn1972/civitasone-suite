import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];

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
        // Reconciliation: which PFMS mechanism produced this row —
        // 'treasury_batch' (this route's own batch/DSC-sign/SFTP path) or
        // 'ekuber_adapter' (adapter-routes.ts's live REST path, unified into
        // this same table/lookup — see migrations/0076_pfms_channel_reconciliation.sql).
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
      })),
    });
  });

  app.get("/v1/finance/pfms/:id/bank-file", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const batch = await repo.findPfmsById(id, ctx.tenantId);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "PFMS batch not found");
    // A row from the e-Kuber adapter channel (adapter-routes.ts) is a
    // completed synchronous REST submission, not a treasury batch — it has
    // no beneficiary set in finance_payments and nothing to put in a bank
    // file. Now that both channels share this table (see migrations/
    // 0076_pfms_channel_reconciliation.sql), guard explicitly instead of
    // silently emitting a header-only CSV.
    if (batch.channel !== "treasury_batch") {
      throw new HttpError(400, "INVALID_CHANNEL", "bank file is only applicable to treasury batch submissions");
    }
    if (batch.submissionStatus !== "signed" && batch.submissionStatus !== "pending") {
      throw new HttpError(400, "INVALID_STATE", "bank file requires signed or pending batch");
    }
    // P1-4: build the NEFT advice from REAL finance_payments beneficiaries
    // (real amount / account / ref / DDO), not a hardcoded stub. Account/IFSC
    // are emitted from captured data; IFSC is blank where no beneficiary bank
    // master exists in this service (documented gap — not fabricated).
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
    // See the same guard in GET /:id/bank-file above — DSC-signing is a
    // treasury batch concept; an e-Kuber adapter row is already a completed
    // (accepted/rejected) synchronous submission with nothing to sign.
    if (batch.channel !== "treasury_batch") {
      throw new HttpError(400, "INVALID_CHANNEL", "signing is only applicable to treasury batch submissions");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.signBatch(ctx, id, body));
  });
}

export { buildBankFile, renderTemplate };
