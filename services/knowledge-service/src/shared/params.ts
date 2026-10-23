import { z } from "zod";
import { HttpError } from "./context.js";

const uuid = z.string().uuid();

/**
 * Read a uuid path param. Every :id in this service addresses a uuid column, so
 * a malformed id used to reach Postgres (22P02) and come back as a retryable
 * 500. Reject it up front as a 400 instead. Throws HttpError (not ZodError)
 * because not every module error handler maps ZodError.
 */
export function pathUuid(params: unknown, name: string = "id"): string {
  const value = (params as Record<string, unknown> | undefined)?.[name];
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "VALIDATION_FAILED", `${name} must be a valid uuid`);
  return parsed.data;
}
