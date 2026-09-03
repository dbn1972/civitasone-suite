import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  detail: z.string().optional(),
  correlationId: z.string(),
  retryable: z.boolean(),
  fieldErrors: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
});

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  hasMore: z.boolean(),
  total: z.number().int().nonnegative().optional(),
  pageSize: z.number().int().positive(),
});

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    pagination: paginationSchema,
  });
}

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/** Standard 202 command acknowledgement (all write endpoints). */
export const acceptedResponseSchema = z.object({
  id: z.string(),
  status: z.literal("accepted"),
  correlationId: z.string(),
  // Nested envelope for the created/affected resource, standardized across all
  // F3 async-write routes (fix/admin-f3-response-envelope). Optional so routes
  // that predate the standardization (still returning the flat shape) keep
  // validating without a breaking schema change.
  data: z.object({ id: z.string() }).passthrough().optional(),
});

export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;
