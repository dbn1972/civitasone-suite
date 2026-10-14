import { z } from "zod";

/** Optional `?q=` free-text search term for list endpoints (trimmed, max 100). */
export const searchQuerySchema = z.object({
  q: z.string().trim().max(100).optional().transform((v) => (v ? v : undefined)),
});

/** Escape LIKE metacharacters so a typed "%" or "_" matches literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}
