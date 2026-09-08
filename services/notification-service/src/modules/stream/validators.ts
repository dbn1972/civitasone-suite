import { z } from "zod";

/**
 * POST /notifications/publish body — SEC-005.
 * This route persists + fans out a notification to an arbitrary userId, so the
 * body is validated strictly (no raw `as` cast) in addition to the internal-
 * caller role gate in routes.ts.
 */
export const publishNotificationBody = z.object({
  userId:   z.string().uuid(),
  type:     z.string().min(1).max(64),
  title:    z.string().min(1).max(256),
  body:     z.string().max(10_000).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type PublishNotificationBody = z.infer<typeof publishNotificationBody>;
