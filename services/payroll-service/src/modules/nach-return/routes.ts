/**
 * NACH Return File — upload and process bank return/response files.
 * Parses the fixed-width return file, counts credited vs returned records,
 * and publishes a command for async reconciliation processing.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { deterministicUuid } from "../../shared/deterministic-id.js";
import { parseNachReturnFile } from "./parser.js";
import { nachReturnFiles } from "./schema.js";
import { disbursementTransfers } from "../disbursement-transfers/schema.js";
import { COMMANDS } from "../../topics.js";

const ADMIN_ROLES = ["payroll_admin", "super_admin"];
const AUDIT_TOPIC = "audit.event.record";

const pathParamSchema = z.object({
  id: z.string().uuid(),
});

/** Name of the issued NACH (part) file this return answers, e.g. NACH_SBIN_3_20261001.txt. */
const fileReferenceSchema = z.string().trim().min(1).max(200).optional();

/** sha256 of the content with line endings and trailing whitespace normalised. */
export function nachReturnFileHash(content: string): string {
  const normalised = content.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").trim();
  return createHash("sha256").update(normalised).digest("hex");
}

export async function nachReturnRoutes(app: FastifyInstance): Promise<void> {
  // Accept raw text body for plain text uploads
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  /**
   * POST /v1/payroll/runs/:id/nach-return
   * Upload a NACH return file (bank response after settlement).
   * Accepts: text/plain (raw file content) or application/json with { content: string }
   */
  app.post("/v1/payroll/runs/:id/nach-return", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const { id: runId } = pathParamSchema.parse(req.params);

    // Extract file content from the request body
    let fileContent: string;
    let requestedFileReference: string | undefined =
      fileReferenceSchema.parse((req.query as Record<string, unknown> | undefined)?.fileReference);

    if (typeof req.body === "string") {
      // text/plain raw body
      fileContent = req.body;
    } else if (req.body && typeof req.body === "object" && "content" in (req.body as Record<string, unknown>)) {
      // JSON body with content field
      fileContent = String((req.body as Record<string, unknown>).content);
      const bodyRef = (req.body as Record<string, unknown>).fileReference;
      if (bodyRef !== undefined) requestedFileReference = fileReferenceSchema.parse(bodyRef);
    } else {
      throw new HttpError(400, "INVALID_REQUEST", "request body must be a NACH return file (text/plain) or JSON with { content: string }");
    }

    if (!fileContent || fileContent.trim().length === 0) {
      throw new HttpError(400, "INVALID_REQUEST", "file content is empty");
    }

    // Parse the return file
    let records;
    try {
      records = parseNachReturnFile(fileContent);
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to parse return file";
      throw new HttpError(400, "INVALID_RETURN_FILE", message);
    }

    // Count outcomes
    let credited = 0;
    let returned = 0;
    let unmatched = 0;

    for (const record of records) {
      if (record.statusCode === "0") {
        credited++;
      } else if (record.statusCode === "1") {
        returned++;
      } else {
        unmatched++;
      }
    }

    // GAP-PAYROLL-DISBURSEMENT-TRANSFERS (review D4): a return file settles
    // ledger rows of ONE issued NACH file, and is applied at most once.
    const fileHash = nachReturnFileHash(fileContent);
    const t = disbursementTransfers;
    const { duplicate, nachFiles } = await scopedRead(async (tx) => {
      const dup = await tx.select({ id: nachReturnFiles.id }).from(nachReturnFiles)
        .where(and(eq(nachReturnFiles.tenantId, ctx.tenantId), eq(nachReturnFiles.runId, runId), eq(nachReturnFiles.fileHash, fileHash)))
        .limit(1);
      const refs = await tx.select({ ref: t.fileReference }).from(t)
        .where(and(eq(t.tenantId, ctx.tenantId), eq(t.runId, runId), eq(t.fileFormat, "nach")));
      return {
        duplicate: Array.from(dup as Iterable<{ id: string }>).length > 0,
        nachFiles: [...new Set(Array.from(refs as Iterable<{ ref: string | null }>).map((r) => r.ref).filter((r): r is string => !!r))].sort(),
      };
    });
    if (duplicate) {
      throw new HttpError(409, "DUPLICATE_RETURN_FILE", "this return file has already been processed for this run");
    }
    let fileReference: string | null;
    if (requestedFileReference !== undefined) {
      if (!nachFiles.includes(requestedFileReference)) {
        throw new HttpError(422, "UNKNOWN_FILE_REFERENCE",
          `no NACH file named ${requestedFileReference} was issued for this run${nachFiles.length ? ` (issued: ${nachFiles.join(", ")})` : ""}`);
      }
      fileReference = requestedFileReference;
    } else if (nachFiles.length > 1) {
      throw new HttpError(422, "FILE_REFERENCE_REQUIRED",
        `this run has more than one NACH file; say which one this return answers with fileReference (one of: ${nachFiles.join(", ")})`);
    } else {
      // 0 files: a run with no NACH ledger rows (e.g. issued before the ledger
      // existed) -- records are still stored, nothing in the ledger matches.
      fileReference = nachFiles[0] ?? null;
    }

    // Publish command for async processing (reconciliation, DB writes).
    // Content-derived messageId: the same file re-sent is deduplicated by the inbox too.
    const messageId = deterministicUuid(`payroll-nach-return:${ctx.tenantId}:${runId}:${fileHash}`);
    await queue.publish(COMMANDS.nachReturnProcess, {
      messageId,
      type: COMMANDS.nachReturnProcess,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        runId,
        fileHash,
        fileReference,
        records: records.map((r) => ({
          reference: r.reference,
          amountMinor: r.amountMinor.toString(),
          statusCode: r.statusCode,
          reasonCode: r.reasonCode,
          reasonText: r.reasonText,
        })),
        summary: { credited, returned, unmatched },
      },
    });

    return reply.status(202).send({
      data: { id: messageId, credited, returned, unmatched, fileReference },
    });
  });
}
