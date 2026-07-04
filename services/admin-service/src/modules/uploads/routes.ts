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
import { presignedPutUrl, presignedGetUrl } from "@civitasone/storage";

const ALL_ROLES = ["hr_admin", "finance_admin", "admin", "super_admin", "officer", "manager", "hr_officer"];

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

    const key = `uploads/${ctx.tenantId}/${body.category}/${randomUUID()}.${ext}`;
    
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
    
    // Validate the key belongs to this tenant
    if (!key.includes(ctx.tenantId)) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "access denied to this file" });
    }

    const downloadUrl = await presignedGetUrl({ key, expiresIn: 3600 });
    return reply.send({ downloadUrl, key });
  });
}
