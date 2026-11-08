import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { OfficialPdf, formatDateIst, DocumentUnavailableError } from "@civitasone/render/official";
import { resolveContext, requireRole, HttpError } from "../../../shared/context.js";
import { sqlClient } from "../../../shared/db.js";
import * as queries from "../queries.js";
import type { FileDetailDto } from "../queries.js";

/** UAT ux-docs: no Chromium, no issuable PDF - 503, never an HTML file served as a PDF. */
async function pdfOr503<T>(render: () => Promise<T>): Promise<T> {
  try {
    return await render();
  } catch (err) {
    if (err instanceof DocumentUnavailableError) throw new HttpError(503, err.code, err.message);
    throw err;
  }
}


const READER_ROLES = ["estab_officer", "estab_admin", "estab_deputy_secretary", "super_admin", "audit_officer"];

/**
 * UAT ux-docs: the note sheet is laid out by the shared OfficialPdf builder, so it embeds
 * Noto Sans Devanagari (Hindi notings print; the old standard Helvetica could not encode
 * Devanagari at all) and dates print in IST.
 */
export async function buildNoteSheetPdf(file: FileDetailDto, headerOrg: string, generatedAt?: Date): Promise<Uint8Array> {
  const pdf = await OfficialPdf.create({
    title: `Note sheet ${file.fileNo}`,
    lang: "bilingual",
    footerNote: `Note sheet · File No. ${file.fileNo} · System-generated note sheet — official record`,
    ...(generatedAt ? { generatedAt } : {}),
  });
  pdf.letterhead({ orgName: headerOrg });
  pdf.title("Note Sheet", "टिप्पणी पृष्ठ");
  pdf.fields([
    { label: "File No", value: file.fileNo },
    { label: "Department", value: file.dept },
    { label: "Subject", value: file.subject },
    ...(file.dakNo ? [{ label: "DAK No", value: file.dakNo }] : []),
    ...(file.dueBy ? [{ label: "SLA Due", value: formatDateIst(file.dueBy) }] : []),
  ], 1);
  pdf.heading("Noting / टिप्पणी");
  if (file.noteSheets.length === 0) {
    pdf.paragraph("No notes recorded.", { muted: true });
  } else {
    file.noteSheets.forEach((n, i) => {
      const ext = n as { noteType?: string; noteStatus?: string; eSigned?: boolean; signatureRef?: string };
      const isGreen = ext.noteType === "green" || ext.eSigned;
      const meta = [n.author, `${isGreen ? "green" : (ext.noteType ?? "yellow")} note`, ext.noteStatus ?? "", isGreen && ext.eSigned ? "e-Signed" : ""].filter(Boolean).join("  ·  ");
      pdf.paragraph(meta, { prefix: `${i + 1}.`, bold: true, gapAfter: 1 });
      pdf.paragraph(n.content, { indent: 18 });
      if (ext.signatureRef) pdf.paragraph(`DSC: ${ext.signatureRef}`, { indent: 18, size: 8, muted: true });
    });
  }
  return pdf.save();
}

export async function noteSheetPrintRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/estab/files/:id/note-sheet/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const file = await queries.getFileDetail(ctx.tenantId, id);
    if (!file) throw new HttpError(404, "NOT_FOUND", "file not found");

    // Tenant organisation name for the header — NOT a hardcoded sovereign/owner
    // string (editions include Govt, PSU, NGO, private). Resolved defensively
    // from the shared tenant registry if present in this service DB.
    let orgName = "";
    try {
      const rows = await sqlClient.unsafe("SELECT name FROM public.tenants WHERE id = $1 LIMIT 1", [ctx.tenantId]);
      orgName = (rows as unknown as Array<{ name?: string }>)[0]?.name ?? "";
    } catch {
      /* tenant registry not replicated in this DB — fall back below */
    }
    const headerOrg = orgName || file.dept || "Office Note Sheet";

    const pdf = await pdfOr503(() => buildNoteSheetPdf(file, headerOrg));
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="note-sheet-${file.fileNo.replace(/[^\w.-]+/g, "_")}.pdf"`)
      .send(Buffer.from(pdf));
  });
}
