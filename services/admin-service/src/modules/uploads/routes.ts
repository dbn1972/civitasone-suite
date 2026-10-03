/**
 * File Upload — S3 pre-signed URL generation via @civitasone/storage.
 * 
 * Flow: Client requests a SigV4 pre-signed PUT URL → uploads directly to S3 →
 * stores the key in the relevant record. No file passes through the API server.
 *
 * Supports: resumes, attachments, documents, profile photos.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole } from "../../shared/context.js";
import { hasAnyRole } from "@civitasone/auth";
import { presignedPutUrl, presignedGetUrl } from "@civitasone/storage";

// Anyone who legitimately mints a presigned URL for these upload flows:
// HR admin/officer (onboarding docs), finance/admin/super_admin/officer/manager (general),
// procurement_officer/procurement_admin (tender documents — matches procurement-service
// tender routes' PROC_ROLES, the endpoint that actually records the uploaded document),
// works_admin/works_operator/dao/do/sdo/section_officer (site-photo uploads — matches
// works-service execution routes' WRITE_ROLES, the endpoint that records the photo),
// and estab_officer/estab_admin/estab_deputy_secretary (case-file attachment uploads —
// matches estab-service files routes' ESTAB_ROLES, the gate on the same
// POST /v1/estab/files/:id/attachments endpoint this presign call feeds; PR #729 wired
// the estab file-attachment UI to this shared presign endpoint but never widened this
// list, so a real estab officer 403'd before ever reaching their own attachments endpoint).
// Kept as an in-place, service-local list rather than a shared constant: it is deliberately
// broader than any single domain's write-role set (it is the union of everyone who uploads
// something via this one presign endpoint), so a shared cross-service constant would not
// obviously be more correct — just note this if the lists start drifting again.
const ALL_ROLES = [
  "hr_admin", "finance_admin", "admin", "super_admin", "officer", "manager", "hr_officer",
  "procurement_officer", "procurement_admin",
  "works_admin", "works_operator", "dao", "do", "sdo", "section_officer",
  "estab_officer", "estab_admin", "estab_deputy_secretary",
  // GAP-ASSETS-INSURANCE-CLAIMS-06: asset staff attach supporting documents to insurance claims.
  "asset_manager", "asset_admin",
];

const ASSET_ONLY_ROLES = ["asset_manager", "asset_admin"];
const NON_ASSET_ROLES = ALL_ROLES.filter((r) => !ASSET_ONLY_ROLES.includes(r));

const ALLOWED_TYPES: Record<string, { maxSizeMb: number; extensions: string[] }> = {
  resume: { maxSizeMb: 5, extensions: ["pdf", "doc", "docx"] },
  attachment: { maxSizeMb: 10, extensions: ["pdf", "doc", "docx", "xls", "xlsx", "jpg", "png"] },
  document: { maxSizeMb: 20, extensions: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"] },
  photo: { maxSizeMb: 2, extensions: ["jpg", "jpeg", "png", "webp"] },
};

const requestBody = z.object({
  category: z.enum(["resume", "attachment", "document", "photo"]),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
});

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  // Generate a SigV4 pre-signed PUT URL for direct browser upload to S3
  app.post("/v1/admin/uploads/presign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = requestBody.parse(req.body);
    
    const cat = ALLOWED_TYPES[body.category];
    if (!cat) return reply.code(400).send({ code: "INVALID_CATEGORY", message: "unknown upload category" });

    const ext = body.filename.split(".").pop()?.toLowerCase() ?? "";
    if (!cat.extensions.includes(ext)) {
      return reply.code(400).send({ code: "INVALID_FILE_TYPE", message: `Allowed types for ${body.category}: ${cat.extensions.join(", ")}` });
    }

    // The uploader's id is part of the key, so a consumer (e.g. an insurance claim) can require that an attached
    // document is the caller's own upload.
    const key = `uploads/${ctx.tenantId}/${body.category}/${ctx.actorId}/${randomUUID()}.${ext}`;
    
    const uploadUrl = await presignedPutUrl({
      key,
      contentType: body.contentType,
      expiresIn: 300,
    });

    return reply.send({
      uploadUrl,
      method: "PUT",
      key,
      expiresIn: 300,
      maxSizeMb: cat.maxSizeMb,
      headers: {
        "Content-Type": body.contentType,
      },
    });
  });

  // Get a pre-signed download URL for an uploaded file
  app.get("/v1/admin/uploads/:key", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const key = (req.params as { key: string }).key;
    
    // Validate the key belongs to this tenant: it must START with this tenant's own prefix (key.includes() was
    // forgeable by any key that merely contained the tenant id somewhere).
    if (!key.startsWith(`uploads/${ctx.tenantId}/`)) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "access denied to this file" });
    }
    // Asset staff may open attachments / documents / photos, not resumes or other HR uploads.
    const category = key.split("/")[2] ?? "";
    if (!hasAnyRole(ctx, NON_ASSET_ROLES) && !["attachment", "document", "photo"].includes(category)) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "access denied to this file" });
    }

    const downloadUrl = await presignedGetUrl({ key, expiresIn: 3600 });
    return reply.send({ downloadUrl, key });
  });
}
