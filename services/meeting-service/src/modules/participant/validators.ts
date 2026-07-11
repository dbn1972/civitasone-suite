/**
 * Participant module — Zod request validators (route boundary).
 *
 * Every write route parses its body through one of these before publishing a command
 * (route → zod → queue.publish → 202). Shapes mirror the `COMMANDS.participant*` payload
 * contracts documented in src/topics.ts; `meetingId` / `participantId` are taken from path
 * params and merged in by the route, so the body schemas below cover the request body only.
 *
 * PII note (Req 15.3): `personalEmail` / `personalPhone` are optional per-meeting contact
 * overrides. They are validated for shape here and encrypted at rest by the `encryptedText()`
 * column (schema.ts); they are never logged.
 *
 * _Requirements: 5.1, 5.2, 5.5, 5.6, 5.7_
 */
import { z } from "zod";
import { PARTICIPANT_ROLES, RSVP_RESPONSES, ATTENDANCE_MODES } from "./domain.js";

const uuid = z.string().uuid();
/** Optimistic-lock version (steering: every mutable entity carries a `version`). */
const version = z.number().int().nonnegative();
const role = z.enum(PARTICIPANT_ROLES);
const rsvpResponse = z.enum(RSVP_RESPONSES);
const attendanceMode = z.enum(ATTENDANCE_MODES);
/** International phone: optional leading +, 7–15 digits (E.164-ish). */
const phone = z.string().trim().regex(/^\+?[0-9]{7,15}$/, "expected a valid phone number");
const email = z.string().trim().email().max(320);

/**
 * Add a single participant (Req 5.1). A `special_invitee` MUST supply a non-empty
 * `agendaItemIds` scope and no other role may (Req 5.7) — mirrored from domain
 * `assertValidRoleAssignment` so the constraint is a 400 at the boundary.
 */
export const participantAddSchema = z
  .object({
    employeeId: uuid,
    role,
    isMandatory: z.boolean().default(true),
    attendanceMode: attendanceMode.optional(),
    agendaItemIds: z.array(uuid).min(1).max(500).optional(),
    personalEmail: email.optional(),
    personalPhone: phone.optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const hasScope = Array.isArray(p.agendaItemIds) && p.agendaItemIds.length > 0;
    if (p.role === "special_invitee" && !hasScope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "special_invitee must be scoped to at least one agenda item",
        path: ["agendaItemIds"],
      });
    }
    if (p.role !== "special_invitee" && hasScope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "agenda item scoping is only valid for a special_invitee",
        path: ["agendaItemIds"],
      });
    }
  });
export type ParticipantAddInput = z.infer<typeof participantAddSchema>;

/** Add one or many participants in a single request (design: "Add participant(s)"). */
export const participantsAddSchema = z.object({
  participants: z.array(participantAddSchema).min(1).max(200),
});
export type ParticipantsAddInput = z.infer<typeof participantsAddSchema>;

/** The fields of a participant that may be patched (Req 5.1, 5.7). */
export const participantPatchSchema = z
  .object({
    role,
    isMandatory: z.boolean(),
    attendanceMode: attendanceMode.nullable(),
    agendaItemIds: z.array(uuid).min(1).max(500).nullable(),
    personalEmail: email.nullable(),
    personalPhone: phone.nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "patch must contain at least one field" });
export type ParticipantPatch = z.infer<typeof participantPatchSchema>;

/** Update a participant; optimistic-locked on `version` (Req 5.1). */
export const participantUpdateSchema = z.object({
  version,
  patch: participantPatchSchema,
});
export type ParticipantUpdateInput = z.infer<typeof participantUpdateSchema>;

/**
 * RSVP response (Req 5.2, 5.6). A `decline` requires a non-empty `declineReason`; accept/tentative
 * must not carry one — enforced here and re-checked in domain `resolveRsvp`. `attendanceMode`
 * optionally records how an accepting participant will attend.
 */
export const participantRespondSchema = z
  .object({
    response: rsvpResponse,
    declineReason: z.string().trim().min(1).max(2_000).optional(),
    attendanceMode: attendanceMode.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.response === "decline" && !body.declineReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a decline response requires a reason",
        path: ["declineReason"],
      });
    }
    if (body.response !== "decline" && body.declineReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "declineReason is only valid with a decline response",
        path: ["declineReason"],
      });
    }
  });
export type ParticipantRespondInput = z.infer<typeof participantRespondSchema>;

/**
 * Designate a proxy/nominee (Req 5.5). The nominee is validated against the committee's approved
 * nominee list in the consumer (domain `assertNomineeAllowed`); optional contact fields let the
 * secretary reach the alternate.
 */
export const participantNominateSchema = z
  .object({
    nomineeId: uuid,
    nomineeEmail: email.optional(),
    nomineePhone: phone.optional(),
    reason: z.string().trim().max(2_000).optional(),
  })
  .strict();
export type ParticipantNominateInput = z.infer<typeof participantNominateSchema>;

// ─── Query / path params ─────────────────────────────────────────────────────

export const participantQueryParams = z.object({
  role: role.optional(),
  invitationStatus: z.enum(["pending", "accepted", "tentative", "declined"]).optional(),
  limit: z.coerce.number().int().positive().max(200).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ParticipantQueryParams = z.infer<typeof participantQueryParams>;

export const meetingIdParam = z.object({ meetingId: uuid });
export const participantIdParam = z.object({
  meetingId: uuid,
  participantId: uuid,
});
