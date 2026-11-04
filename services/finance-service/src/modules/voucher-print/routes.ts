/**
 * Finance print documents (UAT ux-docs): real A4 PDFs with the embedded document font.
 *
 *   GET /v1/finance/journals/:id/pdf       journal / payment voucher (inline)
 *   GET /v1/finance/journals/:id/download  the same, as an attachment
 *   GET /v1/finance/sanctions/:id/pdf      sanction order of an APPROVED sanction
 *
 * Account heads are printed with their names, officers with name and designation (HRMS), and
 * the issuing office from the tenant document identity. A sanction order is refused (422) when
 * the sanctioning officer cannot be named: it is never issued as "Unknown officer".
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveDocIdentity, resolveSignatories, toMinor } from "@civitasone/render/official";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "../gl/repo.js";
import * as budgetRepo from "../budget/repo.js";
import { renderSanctionOrderPdf, renderVoucherPdf, type VoucherDocModel } from "./documents.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
/** Same readers as GET /v1/finance/sanctions/:id. */
const SANCTION_READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer", "procurement_officer"];
const idParam = z.object({ id: z.string().uuid() });
const MANUAL_TYPES = new Set(["journal", "manual", "adjustment"]);
const fileSafe = (v: string) => v.replace(/[^\w.-]+/g, "_");
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" && v ? v : null);

async function voucherPdf(tenantId: string, id: string): Promise<{ pdf: Buffer; voucherNo: string }> {
  const journal = await repo.findJournalById(id);
  if (!journal || journal.tenantId !== tenantId) throw new HttpError(404, "NOT_FOUND", "journal not found");
  const lines = journal.lines ?? [];
  // Account names: the journal lines carry codes only; the chart of accounts names them.
  const nameByCode = await budgetRepo.findHeadNamesByCodes(tenantId, lines.map((l) => l.accountCode));
  const posted = journal.status === "posted";
  const approverId = posted ? journal.updatedBy : null;
  const people = await resolveSignatories(tenantId, [journal.createdBy, approverId]);
  const model: VoucherDocModel = {
    voucherNo: journal.voucherNo,
    postingDate: iso(journal.postingDate),
    type: journal.type ?? "journal",
    status: journal.status ?? "posted",
    lines: lines.map((l) => ({
      accountCode: l.accountCode, accountName: nameByCode.get(l.accountCode) ?? null,
      debitMinor: toMinor(l.debitMinor), creditMinor: toMinor(l.creditMinor), narration: l.narration ?? null,
    })),
    preparedBy: people.get(journal.createdBy) ?? null,
    preparedAt: iso(journal.createdAt),
    approvedBy: approverId ? people.get(approverId) ?? null : null,
    approvedAt: posted ? iso(journal.updatedAt) : null,
    system: !MANUAL_TYPES.has(journal.type ?? "journal"),
  };
  const issuer = await resolveDocIdentity(tenantId);
  return { pdf: Buffer.from(await renderVoucherPdf(model, issuer)), voucherNo: journal.voucherNo };
}

export async function voucherPrintRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/journals/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const { pdf, voucherNo } = await voucherPdf(ctx.tenantId, id);
    return reply.header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="voucher-${fileSafe(voucherNo)}.pdf"`).send(pdf);
  });

  app.get("/v1/finance/journals/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const { pdf, voucherNo } = await voucherPdf(ctx.tenantId, id);
    return reply.header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="voucher-${fileSafe(voucherNo)}.pdf"`).send(pdf);
  });

  app.get("/v1/finance/sanctions/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SANCTION_READER_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await budgetRepo.findSanctionByIdAndTenant(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "sanction not found");
    if (row.status !== "approved") {
      throw new HttpError(409, "SANCTION_NOT_APPROVED", `a sanction order is issued only for an approved sanction; this sanction is ${row.status}`);
    }
    // The sanctioning authority is the officer who approved (the checker), not the maker.
    const people = await resolveSignatories(ctx.tenantId, [row.updatedBy]);
    const signatory = people.get(row.updatedBy);
    if (!signatory) {
      throw new HttpError(422, "SANCTIONING_OFFICER_UNRESOLVED",
        "the sanction order cannot be issued: the approving officer has no name on record. Link the officer login to an HRMS employee record (or an identity profile) and try again.");
    }
    const head = await budgetRepo.findHeadById(row.headId);
    const issuer = await resolveDocIdentity(ctx.tenantId);
    const pdf = await renderSanctionOrderPdf({
      sanctionNo: row.sanctionNo,
      purpose: row.purpose,
      amountMinor: toMinor(row.amountMinor),
      approvedAt: iso(row.updatedAt) ?? new Date().toISOString(),
      head: head && head.tenantId === ctx.tenantId ? { code: head.code, hoaCode: head.hoaCode ?? null, name: head.name } : null,
      efileFileNo: row.efileFileNo ?? null,
      signatory,
    }, issuer);
    return reply.header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="sanction-order-${fileSafe(row.sanctionNo)}.pdf"`).send(Buffer.from(pdf));
  });
}
