import { z } from "zod";

/**
 * Path-param shapes for uuid-keyed resources. Every id column in the document schema is uuid, so a malformed id used
 * to reach Postgres (22P02 invalid_text_representation) and surface as a retryable 500. Parsed here it is a ZodError,
 * which the app-level error handler answers 400 VALIDATION_FAILED.
 */
export const idParam = z.object({ id: z.string().uuid() });
export const fileIdParam = z.object({ fileId: z.string().uuid() });
