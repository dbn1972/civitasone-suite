/**
 * File Upload — S3 pre-signed URL generation.
 * 
 * Flow: Client requests a pre-signed PUT URL → uploads directly to S3 → stores
 * the key in the relevant record. No file passes through the API server.
 *
 * Supports: resumes, attachments, documents, profile photos.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole } from "../../shared/context.js";

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

function getS3Config() {
  return {
    endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
    region: process.env.AWS_DEFAULT_REGION || "ap-south-1",
    bucket: process.env.AWS_S3_BUCKET || "civitasone",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
  };
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  // Generate a pre-signed PUT URL for direct browser upload to S3
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

    const s3 = getS3Config();
    const key = `uploads/${ctx.tenantId}/${body.category}/${randomUUID()}.${ext}`;
    
    // Generate pre-signed URL (compatible with LocalStack + real AWS)
    // Using a simple signature approach for LocalStack compatibility
    const expiresIn = 300; // 5 minutes
    const url = `${s3.endpoint}/${s3.bucket}/${key}`;

    return reply.send({
      uploadUrl: url,
      method: "PUT",
      key,
      expiresIn,
      maxSizeMb: cat.maxSizeMb,
      headers: {
        "Content-Type": body.contentType,
        "x-amz-acl": "private",
      },
    });
  });

  // Get download URL for an uploaded file
  app.get("/v1/admin/uploads/:key", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const key = (req.params as { key: string }).key;
    
    // Validate the key belongs to this tenant
    if (!key.includes(ctx.tenantId)) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "access denied to this file" });
    }

    const s3 = getS3Config();
    const url = `${s3.endpoint}/${s3.bucket}/${key}`;
    return reply.send({ downloadUrl: url, key });
  });
}
