/**
 * Minutes of a meeting as an issuable PDF (UAT ux-docs). The browser print of the minutes page
 * showed the drafter and approver as UUIDs, raw Markdown ("# Minutes", "_No attendance_") and
 * ISO timestamps. This document prints names and designations, the Markdown rendered as text,
 * and every time in IST.
 *
 *   GET /v1/meetings/:meetingId/minutes/pdf
 *
 * Minutes not yet approved print with a DRAFT watermark: they are not an issued record.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  OfficialPdf, formatDateTimeIst, resolveDocIdentity, resolveSignatories, type DocIdentity, type Signatory,
} from "@civitasone/render/official";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const ISSUED = new Set(["approved", "signed", "circulated", "published", "final"]);

export interface MinutesDocModel {
  meetingNumber: string | null;
  title: string;
  scheduledAt: string | null;
  venue: string | null;
  fileReference: string | null;
  status: string;
  content: string;
  chair: Signatory | null;
  secretary: Signatory | null;
  draftedBy: Signatory | null;
  approvedBy: Signatory | null;
  approvedAt: string | null;
  dscSignerName: string | null;
  dscSignedAt: string | null;
}

const who = (s: Signatory | null) => (s ? [s.name, s.designation].filter(Boolean).join(", ") : "");

export async function renderMinutesPdf(m: MinutesDocModel, issuer: DocIdentity, generatedAt?: Date): Promise<Uint8Array> {
  const issued = ISSUED.has(m.status);
  const pdf = await OfficialPdf.create({
    title: `Minutes ${m.meetingNumber ?? m.title}`,
    lang: "bilingual",
    footerNote: `Minutes of meeting ${m.meetingNumber ?? ""}`.trim(),
    watermark: issued ? null : "DRAFT - NOT APPROVED",
    ...(generatedAt ? { generatedAt } : {}),
  });
  pdf.letterhead(issuer);
  pdf.title("Minutes of the Meeting", "बैठक का कार्यवृत्त");
  if (m.meetingNumber || m.fileReference) pdf.refLine(m.meetingNumber ? `No. ${m.meetingNumber}` : "", m.fileReference ? `File No. ${m.fileReference}` : "");
  pdf.fields([
    { label: "Meeting", value: m.title },
    { label: "Date and time", value: formatDateTimeIst(m.scheduledAt) },
    { label: "Venue", value: m.venue ?? "" },
    { label: "Chairperson", value: who(m.chair) },
    { label: "Member secretary", value: who(m.secretary) },
    { label: "Status", value: m.status.replace(/_/g, " ") },
  ]);
  pdf.rule(0.5);
  pdf.markdown(m.content);
  if (m.dscSignerName) pdf.note(`Digitally signed by ${m.dscSignerName}${m.dscSignedAt ? ` on ${formatDateTimeIst(m.dscSignedAt)}` : ""}.`);
  pdf.signatures([
    { caption: "Drafted by", name: m.draftedBy?.name ?? "Member secretary", designation: m.draftedBy?.designation ?? null },
    {
      caption: issued ? "Approved by" : "For approval by",
      name: (m.approvedBy ?? m.chair)?.name ?? "Chairperson",
      designation: (m.approvedBy ?? m.chair)?.designation ?? null,
      extra: [m.approvedAt ? formatDateTimeIst(m.approvedAt) : null],
    },
  ]);
  return pdf.save();
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" && v ? v : null);

export async function minutesPdfRoutes(app: FastifyInstance, readRoles: readonly string[]): Promise<void> {
  app.get("/v1/meetings/:meetingId/minutes/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...readRoles]);
    const { meetingId } = z.object({ meetingId: z.string().uuid() }).parse(req.params);
    const meeting = await repo.getMeetingHeader(ctx.tenantId, meetingId);
    if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
    const row = await repo.getMinutesByMeeting(ctx.tenantId, meetingId);
    if (!row) throw new HttpError(404, "MINUTES_NOT_FOUND", "minutes not found");
    const people = await resolveSignatories(ctx.tenantId, [meeting.chairpersonId, meeting.secretaryId, row.createdBy, row.approvedBy]);
    const get = (id: string | null | undefined) => (id ? people.get(id) ?? null : null);
    const issuer = await resolveDocIdentity(ctx.tenantId);
    const pdf = await renderMinutesPdf({
      meetingNumber: meeting.meetingNumber, title: meeting.title, scheduledAt: iso(meeting.scheduledAt), venue: meeting.venue,
      fileReference: meeting.fileReference, status: row.status, content: row.content,
      chair: get(meeting.chairpersonId), secretary: get(meeting.secretaryId), draftedBy: get(row.createdBy), approvedBy: get(row.approvedBy),
      approvedAt: iso(row.approvedAt), dscSignerName: row.dscSignerName ?? null, dscSignedAt: iso(row.dscSignedAt),
    }, issuer);
    const name = `minutes-${(meeting.meetingNumber ?? meetingId.slice(0, 8)).replace(/[^\w.-]+/g, "_")}.pdf`;
    return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="${name}"`).send(Buffer.from(pdf));
  });
}
