/**
 * meeting-core — Zod request validators (route boundary, Req 1.2, 1.3).
 *
 * Every write route parses its body through one of these schemas before publishing a command
 * (CQRS: route → zod → queue.publish → 202). The body shapes mirror, field-for-field, the
 * `COMMANDS.meeting*` / `COMMANDS.meetingSeries*` payload contracts documented in src/topics.ts.
 * Path parameters (`meetingId`, `meetingTypeId`, `seriesId`) are supplied by the route and merged
 * into the command envelope, so the body schemas below intentionally omit them.
 *
 * Enum vocabularies (meeting states, meeting types, confidentiality levels, series patterns) are
 * declared here as local constants and kept in lock-step with meeting-core/domain.ts. When 3.2's
 * domain.ts lands its exported state/transition sets, these constants and the domain's MUST agree;
 * the values below are the canonical ones defined by Requirement 1 (§1.1, §1.2) and the design's
 * 5-level confidentiality model.
 *
 * _Requirements: 1.2, 1.3_
 */
import { z } from "zod";
import { listQuerySchema } from "@civitasone/schemas";

// ─── Domain vocabularies (mirror the migration CHECK-able value sets / domain.ts) ────

/** Meeting lifecycle states (Req 1.1). Transition targets are drawn from this set. */
export const MEETING_STATES = [
  "draft",
  "scheduled",
  "agenda_locked",
  "in_progress",
  "adjourned",
  "minutes_pending",
  "minutes_approved",
  "closed",
  "archived",
  "cancelled",
] as const;
export type MeetingState = (typeof MEETING_STATES)[number];

/** Meeting classification (Req 1.2). */
export const MEETING_TYPES = ["committee", "board", "departmental", "ad_hoc", "statutory"] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

/** 5-level confidentiality model shared across the service (design §Classification). */
export const CONFIDENTIALITY_LEVELS = ["public", "internal", "confidential", "secret", "top_secret"] as const;
export type ConfidentialityLevel = (typeof CONFIDENTIALITY_LEVELS)[number];

/**
 * Recurring meeting-series patterns (Meeting_Series glossary: weekly, monthly, quarterly, …).
 * Aligned with the committee module's meeting-frequency vocabulary (minus the non-recurring
 * `ad_hoc`) so series and statutory-frequency terms stay consistent across modules.
 */
export const SERIES_PATTERNS = [
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "half_yearly",
  "annual",
] as const;
export type SeriesPattern = (typeof SERIES_PATTERNS)[number];

/** Statutory meeting-frequency obligation for a meeting type (mirrors committee MEETING_FREQUENCIES). */
export const MEETING_TYPE_FREQUENCIES = [
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "half_yearly",
  "annual",
  "ad_hoc",
] as const;
export type MeetingTypeFrequency = (typeof MEETING_TYPE_FREQUENCIES)[number];

// ─── Shared primitives ────────────────────────────────────────────────────────

const uuid = z.string().uuid();
/** Optimistic-lock version (steering: every mutable entity carries a `version`). */
const version = z.number().int().nonnegative();
/** ISO-8601 instant with timezone (matches Drizzle `timestamptz` columns). */
const isoDateTime = z.string().datetime({ offset: true });
/** ISO calendar date `YYYY-MM-DD` (matches Drizzle `date` columns). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected date in YYYY-MM-DD format");
/** Wall-clock time of day `HH:MM` (24h), matches `meeting_series.time_of_day` varchar(5). */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected time in HH:MM (24h) format");
/** Meeting/series duration in minutes: at least 1, capped at a 24-hour day. */
const durationMinutes = z.number().int().positive().max(24 * 60);

const meetingType = z.enum(MEETING_TYPES);
const meetingState = z.enum(MEETING_STATES);
const confidentialityLevel = z.enum(CONFIDENTIALITY_LEVELS);
const seriesPattern = z.enum(SERIES_PATTERNS);
const meetingTypeFrequency = z.enum(MEETING_TYPE_FREQUENCIES);

// ─── Meeting create (Req 1.2 · COMMANDS.meetingCreate) ──────────────────────────

/**
 * Create a meeting in `draft` state (Req 1.2). Mirrors the `meetingCreate` payload contract:
 * required `title`, `type`, `scheduledAt`, `durationMinutes`, `chairpersonId`, `secretaryId`;
 * `committeeId`, `convenerId`, `venue`, `vcEnabled`, `confidentialityLevel` are optional.
 * A physical `venue` and/or a VC session (`vcEnabled`) express the meeting's location.
 */
export const createMeetingSchema = z.object({
  title: z.string().trim().min(1).max(500),
  type: meetingType,
  description: z.string().trim().max(20_000).optional(),
  scheduledAt: isoDateTime,
  durationMinutes,
  committeeId: uuid.optional(),
  chairpersonId: uuid,
  secretaryId: uuid,
  convenerId: uuid.optional(),
  venue: z.string().trim().max(1_000).optional(),
  vcEnabled: z.boolean().optional(),
  confidentialityLevel: confidentialityLevel.optional(),
  fileReference: z.string().trim().max(200).optional(),
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

// ─── Meeting update (COMMANDS.meetingUpdate) ────────────────────────────────────

/**
 * The subset of meeting fields that may be patched. `status` is intentionally excluded — status
 * changes flow exclusively through the transition endpoint (Req 1.3–1.6) so the state-machine and
 * its audit log stay authoritative. Nullable fields may be cleared by sending `null`.
 */
export const meetingPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(20_000).nullable(),
    type: meetingType,
    committeeId: uuid.nullable(),
    chairpersonId: uuid,
    secretaryId: uuid,
    convenerId: uuid.nullable(),
    scheduledAt: isoDateTime,
    durationMinutes,
    venue: z.string().trim().max(1_000).nullable(),
    vcEnabled: z.boolean(),
    vcLink: z.string().trim().url().max(2_000).nullable(),
    confidentialityLevel,
    fileReference: z.string().trim().max(200).nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "patch must contain at least one field" });
export type MeetingPatch = z.infer<typeof meetingPatchSchema>;

/** Update a meeting; optimistic-locked on `version` (COMMANDS.meetingUpdate). */
export const updateMeetingSchema = z.object({
  version,
  patch: meetingPatchSchema,
});
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;

// ─── Meeting transition (Req 1.3–1.6 · COMMANDS.meetingTransition) ──────────────

/**
 * Drive a meeting state transition (Req 1.3–1.6). `to` names the target state; the consumer
 * validates the transition against the (tenant-configurable) state machine and prerequisites
 * (e.g. draft→scheduled needs a chairperson + ≥1 agenda item + future date, Req 1.3).
 * `reason` is required for adjournment/cancellation-style transitions and recorded in the audit
 * log (Req 1.7); `nextMeetingDate` optionally accompanies an adjournment (Req 1.5).
 */
export const transitionMeetingSchema = z.object({
  version,
  to: meetingState,
  reason: z.string().trim().max(2_000).optional(),
  nextMeetingDate: isoDateTime.optional(),
  /** Explicitly waive the minimum-notice requirement on draft→scheduled (short notice, Gap 3). */
  shortNoticeWaiver: z.boolean().optional(),
});
export type TransitionMeetingInput = z.infer<typeof transitionMeetingSchema>;

/** Cancel a meeting (COMMANDS.meetingCancel); optimistic-locked, reason required for the audit log. */
export const cancelMeetingSchema = z.object({
  version,
  reason: z.string().trim().min(1).max(2_000),
});
export type CancelMeetingInput = z.infer<typeof cancelMeetingSchema>;

// ─── Meeting types (config CRUD) ────────────────────────────────────────────────

/**
 * Create a meeting-type template (the `meeting_types` config table). `code` is the tenant-unique
 * short key; `templateConfig` carries the minutes/agenda template shape as opaque JSON; statutory
 * types may declare a mandated `frequency`.
 */
export const createMeetingTypeSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(500),
  description: z.string().trim().max(20_000).optional(),
  templateConfig: z.record(z.unknown()).optional(),
  isStatutory: z.boolean().optional(),
  frequency: meetingTypeFrequency.optional(),
});
export type CreateMeetingTypeInput = z.infer<typeof createMeetingTypeSchema>;

/** Update a meeting-type template — all fields optional; at least one must be supplied. */
export const updateMeetingTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    description: z.string().trim().max(20_000).nullable(),
    templateConfig: z.record(z.unknown()).nullable(),
    isStatutory: z.boolean(),
    frequency: meetingTypeFrequency.nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "patch must contain at least one field" });
export type UpdateMeetingTypeInput = z.infer<typeof updateMeetingTypeSchema>;

// ─── Meeting series (recurring pattern) ─────────────────────────────────────────

/**
 * Constitute a recurring meeting series (COMMANDS.meetingSeriesCreate). `pattern` selects the
 * recurrence; `dayOfWeek` (0=Sun … 6=Sat) applies to weekly/fortnightly patterns and `dayOfMonth`
 * (1–31) to monthly+ patterns. `timeOfDay` + `durationMinutes` template each generated instance.
 */
export const createSeriesSchema = z
  .object({
    committeeId: uuid,
    pattern: seriesPattern,
    startDate: isoDate,
    endDate: isoDate.optional(),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    timeOfDay: timeOfDay.optional(),
    durationMinutes: durationMinutes.optional(),
  })
  .refine((s) => s.endDate === undefined || s.endDate >= s.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });
export type CreateSeriesInput = z.infer<typeof createSeriesSchema>;

/** Update a recurring series — all fields optional; at least one must be supplied. */
export const updateSeriesSchema = z
  .object({
    pattern: seriesPattern,
    endDate: isoDate.nullable(),
    dayOfWeek: z.number().int().min(0).max(6).nullable(),
    dayOfMonth: z.number().int().min(1).max(31).nullable(),
    timeOfDay: timeOfDay.nullable(),
    durationMinutes,
    isActive: z.boolean(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "patch must contain at least one field" });
export type UpdateSeriesInput = z.infer<typeof updateSeriesSchema>;

/** Materialize concrete meeting instances from a series up to `upToDate` (COMMANDS.meetingSeriesGenerate). */
export const generateSeriesSchema = z.object({
  upToDate: isoDate,
});
export type GenerateSeriesInput = z.infer<typeof generateSeriesSchema>;

// ─── List / filter / search queries ─────────────────────────────────────────────

/**
 * Meeting list filters (GET /v1/meetings). Extends the shared `listQuerySchema` (limit/offset,
 * capped at 500 / max page size honored at the repo) with meeting-specific filters. All filters
 * are optional and combine with AND semantics; `from`/`to` bound `scheduledAt`.
 */
export const listMeetingsQuerySchema = listQuerySchema.extend({
  status: meetingState.optional(),
  type: meetingType.optional(),
  committeeId: uuid.optional(),
  seriesId: uuid.optional(),
  chairpersonId: uuid.optional(),
  confidentialityLevel: confidentialityLevel.optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});
export type ListMeetingsQuery = z.infer<typeof listMeetingsQuerySchema>;

/**
 * Complex meeting search (POST /v1/meetings/search body). Free-text `q` plus multi-valued filters
 * (per API-design standard: POST body for complex queries with multiple conditions). Reuses the
 * shared pagination fields via `listQuerySchema`.
 */
export const searchMeetingsSchema = listQuerySchema.extend({
  q: z.string().trim().max(500).optional(),
  statuses: z.array(meetingState).max(MEETING_STATES.length).optional(),
  types: z.array(meetingType).max(MEETING_TYPES.length).optional(),
  committeeIds: z.array(uuid).max(200).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});
export type SearchMeetingsInput = z.infer<typeof searchMeetingsSchema>;

/** Meeting-types list filters (GET /v1/meetings/types). */
export const listMeetingTypesQuerySchema = listQuerySchema.extend({
  isStatutory: z.coerce.boolean().optional(),
});
export type ListMeetingTypesQuery = z.infer<typeof listMeetingTypesQuerySchema>;

/** Meeting-series list filters (GET /v1/meetings/series). */
export const listSeriesQuerySchema = listQuerySchema.extend({
  committeeId: uuid.optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ListSeriesQuery = z.infer<typeof listSeriesQuerySchema>;

// ─── Path params ────────────────────────────────────────────────────────────────

export const meetingIdParam = z.object({ meetingId: uuid });
export const meetingTypeIdParam = z.object({ meetingTypeId: uuid });
export const seriesIdParam = z.object({ seriesId: uuid });
