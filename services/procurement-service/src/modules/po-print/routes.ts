/**
 * Printable procurement documents (UAT ux-docs): real A4 PDFs with the embedded document font.
 *
 *   GET /v1/procurement/pos/:id/pdf        purchase order (inline)
 *   GET /v1/procurement/pos/:id/download   purchase order (attachment)
 *   GET /v1/procurement/grns/:id/pdf       goods receipt note (inline)
 *
 * The buyer header, address and GSTIN come from the tenant document identity; officer names and
 * designations from HRMS. See po-document.ts for the old "No line items" root cause.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveDocIdentity, resolveSignatories, PdfRendererUnavailableError } from "@civitasone/render/official";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "../po/queries.js";
import * as grnQueries from "../grn/queries.js";
import { getVendor } from "../vendor/queries.js";
import { poDocModel, renderPoPdf, renderGrnPdf, type GrnDocModel } from "./po-document.js";

/** UAT ux-docs: no Chromium, no issuable PDF - 503, never an HTML file served as a PDF. */
async function pdfOr503<T>(render: () => Promise<T>): Promise<T> {
  try {
    return await render();
  } catch (err) {
    if (err instanceof PdfRendererUnavailableError) throw new HttpError(503, err.code, err.message);
    throw err;
  }
}


const READER_ROLES = ["procurement_officer", "procurement_admin", "super_admin", "finance_officer", "audit_officer"];
// Same readers as GET /v1/procurement/grns/:id.
const GRN_READER_ROLES = ["procurement_officer", "procurement_admin", "super_admin", "store_officer", "audit_officer", "finance_officer"];
const idParam = z.object({ id: z.string().uuid() });

const fileSafe = (v: string) => v.replace(/[^\w.-]+/g, "_");

async function poPdf(tenantId: string, id: string): Promise<{ pdf: Buffer; poNo: string }> {
  const po = await queries.getPo(id, tenantId);
  if (!po) throw new HttpError(404, "NOT_FOUND", "PO not found");
  const vendor = typeof po.vendorId === "string" ? await getVendor(po.vendorId, tenantId) : null;
  const model = poDocModel(po, vendor ? { gstin: vendor.gstin ?? null, address: (vendor as { address?: string | null }).address ?? null } : null);
  const [buyer, people] = await Promise.all([
    resolveDocIdentity(tenantId),
    resolveSignatories(tenantId, [typeof po.createdBy === "string" ? po.createdBy : null]),
  ]);
  const signatory = typeof po.createdBy === "string" ? people.get(po.createdBy) ?? null : null;
  return { pdf: Buffer.from(await renderPoPdf(model, buyer, signatory)), poNo: model.poNo || id.slice(0, 8) };
}

export async function poPrintRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/pos/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const { pdf, poNo } = await pdfOr503(() => poPdf(ctx.tenantId, id));
    return reply.header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="PO-${fileSafe(poNo)}.pdf"`).send(pdf);
  });

  app.get("/v1/procurement/pos/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const { pdf, poNo } = await pdfOr503(() => poPdf(ctx.tenantId, id));
    return reply.header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="PO-${fileSafe(poNo)}.pdf"`).send(pdf);
  });

  app.get("/v1/procurement/grns/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRN_READER_ROLES);
    const { id } = idParam.parse(req.params);
    const grn = await grnQueries.getGrn(id, ctx.tenantId);
    if (!grn) throw new HttpError(404, "NOT_FOUND", "GRN not found");
    // PO line descriptions for the received items (poItemRef = the PO line id).
    const po = typeof grn.poId === "string" ? await queries.getPo(grn.poId, ctx.tenantId) : null;
    const poLines = new Map(((po?.lineItems as Array<{ id: string; description?: string }> | undefined) ?? []).map((l) => [l.id, l.description ?? ""]));
    const items = (grn.items as Array<{ poItemRef: string; itemCode: string; orderedQty: number; receivedQty: number; acceptedQty: number; unit: string }> | undefined) ?? [];
    const insp = grn.inspection as { inspectorId?: string; inspectionDate?: string; result?: string; remarks?: string } | null;
    const model: GrnDocModel = {
      grnNo: String(grn.grnNo ?? ""),
      receivedDate: typeof grn.receivedDate === "string" ? grn.receivedDate : null,
      status: String(grn.status ?? ""),
      // The PO reference NUMBER (PO/2026/0035), never the internal "procurement_po:<uuid>" ref.
      poNo: typeof grn.poNo === "string" ? grn.poNo : null,
      vendor: String(grn.vendor ?? ""),
      notes: typeof grn.notes === "string" ? grn.notes : null,
      items: items.map((i) => ({
        itemCode: i.itemCode, description: poLines.get(i.poItemRef.replace(/^procurement_po_item:/, "")) ?? "",
        orderedQty: i.orderedQty, receivedQty: i.receivedQty, acceptedQty: i.acceptedQty, unit: i.unit,
      })),
      inspection: insp ? { result: insp.result ?? "", date: insp.inspectionDate ?? null, remarks: insp.remarks ?? null } : null,
    };
    const receivedById = typeof grn.createdBy === "string" ? grn.createdBy : null;
    const inspectorId = insp?.inspectorId ?? null;
    const [buyer, people] = await Promise.all([resolveDocIdentity(ctx.tenantId), resolveSignatories(ctx.tenantId, [receivedById, inspectorId])]);
    const pdf = await pdfOr503(() => renderGrnPdf(model, buyer, receivedById ? people.get(receivedById) ?? null : null, inspectorId ? people.get(inspectorId) ?? null : null));
    return reply.header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="GRN-${fileSafe(model.grnNo || id.slice(0, 8))}.pdf"`).send(Buffer.from(pdf));
  });
}
