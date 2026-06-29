import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { resolveContext, requireRole, HttpError } from "../../../shared/context.js";
import { sqlClient } from "../../../shared/db.js";
import * as queries from "../queries.js";
import type { FileDetailDto } from "../queries.js";

const READER_ROLES = ["estab_officer", "estab_admin", "estab_deputy_secretary", "super_admin", "audit_officer"];

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("en-IN"); } catch { return iso; }
}

/** Wrap a string to fit `maxWidth` at `size` for the given font. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = "";
    for (const word of rawLine.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    out.push(line);
  }
  return out;
}

async function buildNoteSheetPdf(file: FileDetailDto, headerOrg: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595, PAGE_H = 842, MARGIN = 50;
  const contentW = PAGE_W - MARGIN * 2;
  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const ensure = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };
  const line = (text: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const x = MARGIN + (opts.indent ?? 0);
    for (const l of wrapText(text, f, size, contentW - (opts.indent ?? 0))) {
      ensure(size + 4);
      page.drawText(l, { x, y: y - size, size, font: f, color: opts.color ?? rgb(0.1, 0.1, 0.1) });
      y -= size + 4;
    }
  };
  const gap = (h: number) => { y -= h; };

  // Header
  const title = `${headerOrg} — Note Sheet`;
  ensure(22);
  page.drawText(title.length > 70 ? title.slice(0, 70) : title, {
    x: MARGIN, y: y - 16, size: 16, font: bold, color: rgb(0.06, 0.2, 0.45),
  });
  y -= 28;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  gap(14);

  // Meta
  line(`File No: ${file.fileNo}`, { font: bold, size: 11 });
  line(`Subject: ${file.subject}`);
  line(`Department: ${file.dept}`);
  if (file.dakNo) line(`DAK No: ${file.dakNo}`);
  if (file.dueBy) line(`SLA Due: ${fmtDate(file.dueBy)}`);
  gap(10);

  // Notings
  line("Noting", { font: bold, size: 12, color: rgb(0.06, 0.2, 0.45) });
  gap(4);
  if (file.noteSheets.length === 0) {
    line("No notes recorded.", { color: rgb(0.5, 0.5, 0.5) });
  } else {
    file.noteSheets.forEach((n, i) => {
      const ext = n as { noteType?: string; noteStatus?: string; eSigned?: boolean; signatureRef?: string };
      const isGreen = ext.noteType === "green" || ext.eSigned;
      gap(6);
      ensure(16);
      // marker bar (green/yellow)
      page.drawRectangle({
        x: MARGIN, y: y - 12, width: 3, height: 14,
        color: isGreen ? rgb(0.13, 0.55, 0.27) : rgb(0.85, 0.65, 0.05),
      });
      line(`${i + 1}. ${n.author}  ·  ${ext.noteType ?? "yellow"}  ·  ${ext.noteStatus ?? ""}${isGreen ? "  ·  e-Signed" : ""}`,
        { font: bold, size: 10, indent: 10 });
      line(n.content, { indent: 10 });
      if (ext.signatureRef) line(`DSC: ${ext.signatureRef}`, { size: 8, color: rgb(0.45, 0.45, 0.45), indent: 10 });
    });
  }

  gap(20);
  ensure(14);
  page.drawText("System-generated note sheet — official record.", {
    x: MARGIN, y: y - 9, size: 8, font, color: rgb(0.5, 0.5, 0.5),
  });

  return doc.save();
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
      const rows = await sqlClient`SELECT name FROM public.tenants WHERE id = ${ctx.tenantId} LIMIT 1`;
      orgName = (rows as unknown as Array<{ name?: string }>)[0]?.name ?? "";
    } catch {
      /* tenant registry not replicated in this DB — fall back below */
    }
    const headerOrg = orgName || file.dept || "Office Note Sheet";

    const pdf = await buildNoteSheetPdf(file, headerOrg);
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="note-sheet-${file.fileNo.replace(/[^\w.-]+/g, "_")}.pdf"`)
      .send(Buffer.from(pdf));
  });
}
