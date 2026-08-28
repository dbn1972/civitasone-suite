import { z } from "zod";

export const caseIdParam = z.object({ id: z.string().uuid() });
export const noticeIdParam = z.object({ id: z.string().uuid() });

/** Issue a notice to a party on a case (§21). `issueDate` is a calendar date.
 *  `caseId` comes from the `:id` path segment (see routes.ts), not the body — a
 *  `caseId` body field used to be accepted here but was silently discarded in
 *  commands.ts (the path value always won), so it has been removed rather than
 *  left as dead, misleading input. */
export const issueNoticeBody = z.object({
  noticeType: z.string().trim().min(1).max(48),
  issuedTo:   z.string().trim().max(500).optional(),
  issueDate:  z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "issueDate must be YYYY-MM-DD"),
});
export type IssueNoticeBody = z.infer<typeof issueNoticeBody>;

/** Record a service attempt against a notice (§21 service of process). */
export const recordServiceBody = z.object({
  serviceMode:    z.enum(["post", "email", "publication", "personal", "substituted"]),
  recipient:      z.string().trim().max(500).optional(),
  dispatchRef:    z.string().trim().max(64).optional(),
  deliveryStatus: z.enum(["pending", "served", "unserved", "refused"]).optional(),
  servedAt:       z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "servedAt must be YYYY-MM-DD").optional(),
  proof:          z.string().trim().max(2000).optional(),
});
export type RecordServiceBody = z.infer<typeof recordServiceBody>;

/** Update a notice's lifecycle status (§21). `expectedVersion` is the
 *  optimistic-lock token. */
export const updateNoticeStatusBody = z.object({
  status:          z.enum(["served", "unserved", "cancelled"]),
  expectedVersion: z.coerce.number().int().min(1),
});
export type UpdateNoticeStatusBody = z.infer<typeof updateNoticeStatusBody>;
