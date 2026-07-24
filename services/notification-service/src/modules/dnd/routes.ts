import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const DAY_ENUM = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

const setWindowBody = z.object({
  userId: z.string().uuid(),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "must be HH:mm or HH:mm:ss"),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "must be HH:mm or HH:mm:ss"),
  timezone: z.string().min(1).max(64),
  days: z.array(DAY_ENUM).min(1).optional(),
});

const updateWindowBody = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  timezone: z.string().min(1).max(64).optional(),
  days: z.array(DAY_ENUM).min(1).optional(),
  enabled: z.boolean().optional(),
});

const windowIdParam = z.object({ id: z.string().uuid() });
const userIdQuery = z.object({ userId: z.string().uuid() });

export async function dndRoutes(app: FastifyInstance): Promise<void> {
  // Set (create) a DND window
  app.post("/v1/dnd", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = setWindowBody.parse(req.body);

    // Check for overlapping windows for the same user
    const existing = await repo.findActiveWindows(ctx.tenantId, body.userId);
    if (existing.length > 0) {
      // Simple overlap check: if start/end times overlap with any existing window
      for (const win of existing) {
        if (hasTimeOverlap(body.startTime, body.endTime, win.startTime as string, win.endTime as string, body.days ?? ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], win.days as string[])) {
          throw new HttpError(409, "OVERLAPPING_WINDOW", "DND window overlaps with an existing window");
        }
      }
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.setDndWindow(ctx, body));
  });

  // List DND windows for a user
  app.get("/v1/dnd", async (req, reply) => {
    const ctx = resolveContext(req);
    const { userId } = userIdQuery.parse(req.query);
    const windows = await repo.findActiveWindows(ctx.tenantId, userId);
    return reply.send({ data: windows, meta: { total: windows.length } });
  });

  // Update a DND window
  app.patch("/v1/dnd/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = windowIdParam.parse(req.params);
    const body = updateWindowBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDndWindow(ctx, id, body));
  });

  // Delete (disable) a DND window
  app.delete("/v1/dnd/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = windowIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDndWindow(ctx, id, { enabled: false }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

/** Simple check: do any of the days overlap and are time ranges overlapping? */
function hasTimeOverlap(
  startA: string, endA: string, startB: string, endB: string,
  daysA: string[], daysB: string[],
): boolean {
  // First check if any days overlap
  const commonDays = daysA.filter((d) => daysB.includes(d));
  if (commonDays.length === 0) return false;

  // Parse times to minutes
  const sA = parseTime(startA);
  const eA = parseTime(endA);
  const sB = parseTime(startB);
  const eB = parseTime(endB);

  // Handle non-overnight windows with simple range overlap
  if (sA < eA && sB < eB) {
    return sA < eB && sB < eA;
  }

  // For overnight windows, they almost always overlap with something — conservative check
  return true;
}

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
