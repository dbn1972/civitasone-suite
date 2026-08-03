/**
 * NACH Return File — upload and process bank return/response files.
 * Parses the fixed-width return file, counts credited vs returned records,
 * and publishes a command for async reconciliation processing.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { parseNachReturnFile } from "./parser.js";
import { COMMANDS } from "../../topics.js";

const ADMIN_ROLES = ["payroll_admin", "super_admin"];
const AUDIT_TOPIC = "audit.event.record";

const pathParamSchema = z.object({
  id: z.string().uuid(),
});

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

    if (typeof req.body === "string") {
      // text/plain raw body
      fileContent = req.body;
    } else if (req.body && typeof req.body === "object" && "content" in (req.body as Record<string, unknown>)) {
      // JSON body with content field
      fileContent = String((req.body as Record<string, unknown>).content);
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

    // Publish command for async processing (reconciliation, DB writes)
    const messageId = randomUUID();
    await queue.publish(COMMANDS.nachReturnProcess, {
      messageId,
      type: COMMANDS.nachReturnProcess,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        runId,
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
      data: { id: messageId, credited, returned, unmatched },
    });
  });
}
