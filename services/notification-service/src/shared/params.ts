import { z } from "zod";
import { HttpError } from "./context.js";

const uuid = z.string().uuid();

/**
 * Read a uuid path param. The :id of dlt templates, the inbound review queue
 * and message attachments are uuid columns, so a malformed id used to reach
 * Postgres (22P02) and come back as a retryable 500. Reject it up front as a
 * 400 instead. Throws HttpError (not ZodError) because not every module error
 * handler maps ZodError.
 */
export function pathUuid(params: unknown, name: string = "id"): string {
  const parsed = uuid.safeParse((params as Record<string, unknown> | undefined)?.[name]);
  if (!parsed.success) throw new HttpError(400, "VALIDATION_FAILED", `${name} must be a valid uuid`);
  return parsed.data;
}
