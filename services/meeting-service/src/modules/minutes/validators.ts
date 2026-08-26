/**
 * Minutes module — Zod request validators (route boundary).
 *
 * Every write route parses its body through one of these before publishing a command
 * (route → zod → queue.publish → 202). Shapes mirror the `COMMANDS.minutes*` payload
 * contracts documented in src/topics.ts; `meetingId` / `minutesId` are taken from the path
 * param and merged in by the route, so the body schemas below cover the request body only.
 *
 * _Requirements: 7.1, 7.2, 7.4, 7.5, 7.6, 8.1_
 */
import { z } from "zod";
import { MINUTES_TEMPLATE_TYPES } from "./domain.js";

const uuid = z.string().uuid();
/** Optimistic-lock version (steering: every mutable entity carries a `version`). */
const version = z.number().int().nonnegative();
const templateType = z.enum(MINUTES_TEMPLATE_TYPES);

/**
 * Create a minutes draft (Req 7.1, 7.2). `templateType` selects the rendering shape and
 * defaults to `summary` (matching the migration default) when omitted; the meeting metadata,
 * attendance, and agenda placeholders are assembled by the consumer.
 */
export const minutesCreateSchema = z.object({
  templateType: templateType.optional(),
});
export type MinutesCreateInput = z.infer<typeof minutesCreateSchema>;

/**
 * Update the minutes draft content (Req 7.1, 7.8). Optimistic-locked on `version`; the
 * consumer snapshots the prior content into `minutes_versions` and bumps `current_version`.
 * Rejected on locked minutes at the domain layer (`assertMinutesEditable`).
 */
export const minutesUpdateSchema = z.object({
  version,
  content: z.string().min(1).max(1_000_000),
  changeNote: z.string().trim().max(2_000).optional(),
});
export type MinutesUpdateInput = z.infer<typeof minutesUpdateSchema>;

/** Submit the draft into the approval workflow (Req 7.3). Optimistic-locked on `version`. */
export const minutesSubmitSchema = z.object({
  version,
});
export type MinutesSubmitInput = z.infer<typeof minutesSubmitSchema>;

/**
 * Approve the minutes (Req 7.5). Optimistic-locked on `version`. `approverId` is ALWAYS the
 * authenticated caller — commands.ts `minutesApprove` resolves it as `body.approverId ??
 * ctx.actorId`, so this field is accepted for wire/type compatibility but its value is ALWAYS
 * discarded (never trusted from the client): a client-supplied `approverId` previously let any
 * caller with approve rights record an arbitrary user as the approver (identity spoofing —
 * audit finding). There is no elevated "approve on behalf of" role/flow in this codebase today
 * to preserve, so the safer fix is to make the field fully non-authoritative rather than add an
 * unrequested cross-check; if "approve on behalf of" becomes a real requirement, resolve it in
 * commands.ts against `ctx.actorId` + the committee's actual chairperson, not a bare client
 * value. Optional approval comments are retained for the audit trail.
 */
export const minutesApproveSchema = z.object({
  version,
  /** Accepted but always discarded — see the schema doc comment above. Never trust this. */
  approverId: uuid.optional().transform(() => undefined),
  comments: z.string().trim().max(4_000).optional(),
});
export type MinutesApproveInput = z.infer<typeof minutesApproveSchema>;

/**
 * Reject the minutes (Req 7.6). Rejection comments are mandatory: the draft is returned to the
 * secretary with these comments and the version is incremented before re-submission.
 */
export const minutesRejectSchema = z.object({
  version,
  rejectionComments: z.string().trim().min(1).max(4_000),
});
export type MinutesRejectInput = z.infer<typeof minutesRejectSchema>;

/**
 * Apply the chairperson's DSC to the approved minutes (Req 8.1). Optimistic-locked on
 * `version`. `signerId` is ALWAYS the authenticated caller — commands.ts `minutesSign`
 * resolves it as `body.signerId ?? ctx.actorId` — for the same identity-spoofing reason as
 * `approverId` above: the field is accepted but its value is always discarded, never trusted
 * from the client. Signing does not mutate content — it seals the hash chain and DSC block.
 */
export const minutesSignSchema = z.object({
  version,
  /** Accepted but always discarded — see the schema doc comment above. Never trust this. */
  signerId: uuid.optional().transform(() => undefined),
});
export type MinutesSignInput = z.infer<typeof minutesSignSchema>;

/**
 * Circulate the signed minutes (Req 8.3). An empty/omitted `recipientIds` circulates to the
 * default distribution (all participants + record repository), resolved by the consumer.
 */
export const minutesCirculateSchema = z.object({
  recipientIds: z.array(uuid).max(1_000).optional(),
});
export type MinutesCirculateInput = z.infer<typeof minutesCirculateSchema>;

/** Kind of inline annotation a reviewer may attach during approval (Req 7.4). */
export const MINUTES_COMMENT_KINDS = ["comment", "suggestion", "dissent"] as const;

/**
 * Add an inline comment / suggested edit / dissent note on a specific paragraph of the minutes
 * while they are in the approval workflow (Req 7.4). `anchor` identifies the target paragraph
 * (e.g. a heading slug or paragraph id); `paragraphIndex` is an optional numeric fallback.
 */
export const minutesCommentSchema = z.object({
  anchor: z.string().trim().min(1).max(200),
  paragraphIndex: z.number().int().nonnegative().optional(),
  comment: z.string().trim().min(1).max(4_000),
  kind: z.enum(MINUTES_COMMENT_KINDS).default("comment"),
});
export type MinutesCommentInput = z.infer<typeof minutesCommentSchema>;

/**
 * Public minutes verification request (Req 8.4). Callers supply either the `minutesId` or the
 * `hashCurrent` scanned from the document QR code; at least one is required.
 */
export const minutesVerifySchema = z
  .object({
    minutesId: uuid.optional(),
    hashCurrent: z.string().trim().length(64).optional(),
  })
  .refine((v) => Boolean(v.minutesId || v.hashCurrent), {
    message: "minutesId or hashCurrent is required",
  });
export type MinutesVerifyInput = z.infer<typeof minutesVerifySchema>;
