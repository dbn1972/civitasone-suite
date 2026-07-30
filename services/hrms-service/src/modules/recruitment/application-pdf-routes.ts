/**
 * Downloadable submitted-application copy (checklist R-RA-0105).
 *
 *   GET /v1/hrms/applications/:id/pdf   application copy (PDF), HR-generated
 *
 * Renders the candidate's submitted data to a PDF via @civitasone/render
 * (Playwright, with an html-only fallback when chromium is unavailable). Internal
 * screening artefacts are never included; HTML is escaped in the builder.
 *
 * AUTH: HR-only (staff, tenant-scoped) — HR generates the copy to hand to the
 * candidate. Candidate self-download is deferred until candidate auth exists; if
 * the audience is ever widened to applicants, add a candidate→application
 * ownership predicate before broadening the role list (else it is an IDOR).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { renderPdf } from "@civitasone/render";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { buildApplicationHtml } from "./application-pdf.js";
import * as screeningRepo from "./screening-repo.js";
import * as repo from "./application-pdf-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

export async function applicationPdfRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/applications/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);

    const a = await screeningRepo.findApplication(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
    const vacancy = await repo.getVacancyHeader(ctx.tenantId, a.jobOpeningId);

    const html = buildApplicationHtml({
      id: a.id, applicantName: a.applicantName, applicationNo: a.applicationNo,
      vacancyTitle: vacancy?.title ?? null, vacancyRef: vacancy?.refNo ?? null,
      category: a.category, qualification: a.qualification, experienceYears: a.experienceYears,
      status: a.status, appliedAt: a.appliedAt,
    });

    const result = await renderPdf({ html, format: "A4" });
    // When chromium is unavailable the renderer falls back to html-only; report
    // the true content type so the client is not misled into treating HTML as PDF.
    const contentType = result.mode === "playwright" ? "application/pdf" : "text/html; charset=utf-8";
    const ext = result.mode === "playwright" ? "pdf" : "html";
    const fileLabel = (a.applicationNo ?? a.id).replace(/[^A-Za-z0-9._-]/g, "_");
    return reply
      .header("content-type", contentType)
      .header("content-disposition", `attachment; filename="application_${fileLabel}.${ext}"`)
      .header("x-render-mode", result.mode)
      .send(result.buffer);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err.message, correlationId });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
