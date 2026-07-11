/**
 * VC-integration module — Zod request validators (route boundary).
 *
 * Every write route parses its body through one of these before publishing a command
 * (route → zod → queue.publish → 202). Shapes mirror the `COMMANDS.vc*` payload contracts
 * (vcSessionCreate, vcSessionEnd, vcRecordingStart, vcRecordingStop, vcWebhook) in
 * src/topics.ts. `meetingId` comes from the path param and is merged in by the route, so the
 * body schemas below cover the request body only.
 *
 * The provider enum is sourced from `adapter.ts` (`VC_PROVIDERS`) so the wire contract and the
 * adapter's supported-platform vocabulary can never drift apart (Req 13.1).
 *
 * _Requirements: 13.1, 13.2, 13.3, 13.4, 13.7, 13.8_
 */
import { z } from "zod";
import { VC_PROVIDERS } from "./adapter.js";

const uuid = z.string().uuid();
/** Provider platform enum (nic_vc | ms_teams | google_meet | zoom | webrtc). */
const vcProvider = z.enum(VC_PROVIDERS);

// ─── Create session (Req 13.2) ─────────────────────────────────────────────────

/**
 * Create a VC session for a meeting (Req 13.2). `platform` optionally pins the preferred
 * provider (otherwise the tenant's configured priority chain leads, Req 13.5). When
 * `recordingEnabled` is true the consumer starts recording at session creation (Req 13.8).
 */
export const vcCreateSessionSchema = z.object({
  platform: vcProvider.optional(),
  recordingEnabled: z.boolean().default(false),
});
export type VcCreateSessionInput = z.infer<typeof vcCreateSessionSchema>;

// ─── Recording toggle + end (Req 13.7, 13.8) ────────────────────────────────────

/**
 * Target an existing VC session for a recording toggle (start/stop) or to end it (Req 13.7,
 * 13.8). `vcSessionId` identifies the session provisioned by an earlier create; the route
 * confirms it belongs to the path meeting before publishing.
 */
export const vcSessionActionSchema = z.object({
  vcSessionId: uuid,
});
export type VcSessionActionInput = z.infer<typeof vcSessionActionSchema>;

// ─── Provider webhook (Req 13.3) ─────────────────────────────────────────────────

/**
 * VC provider callback: a participant joined the VC session (Req 13.3). Delivered by the VC
 * adapter's callback relay (service-to-service, authenticated); the consumer records the
 * join as VC-presence attendance so quorum/attendance reflect remote participants (Req 6.7).
 *
 * `participantId` is the resolved INTERNAL meeting participant the external VC identity maps
 * to; `externalUserId`/`displayName` retain the provider-side identity for diagnostics.
 * `eventId` (when supplied by the provider) is used as the command messageId so a redelivered
 * webhook is deduped by the consumer's `markProcessed` (the (meeting, participant) unique index
 * on the attendance table is the ultimate idempotency guard).
 */
export const vcWebhookSchema = z.object({
  event: z.literal("participant.joined").default("participant.joined"),
  participantId: uuid,
  vcSessionId: uuid.optional(),
  eventId: z.string().trim().min(1).max(200).optional(),
  joinedAt: z.string().datetime({ offset: true }).optional(),
  externalUserId: z.string().trim().min(1).max(200).optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
});
export type VcWebhookInput = z.infer<typeof vcWebhookSchema>;

// ─── Path params ─────────────────────────────────────────────────────────────

/** `:meetingId` path param (all seven VC endpoints). */
export const meetingIdParam = z.object({ meetingId: uuid });
