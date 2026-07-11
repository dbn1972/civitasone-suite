/**
 * committee module — Zod request validators (route boundary, Req 2.1–2.7).
 *
 * Parsed at the route boundary before any command is published (CQRS). The
 * `quorumRuleSchema` is the wire contract for the `committees.quorum_rule` JSONB and is
 * kept in lock-step with `domain.ts` `QuorumRule` — a `.superRefine` mirrors
 * `assertValidQuorumRule` so an invalid rule is rejected as a 400 at the edge (code
 * `COMMITTEE_QUORUM_RULE_INVALID`) rather than surfacing as a domain error later.
 */
import { z } from "zod";
import {
  COMMITTEE_TYPES,
  MEMBER_ROLES,
  VOTING_RULES,
  MEETING_FREQUENCIES,
  MEMBERSHIP_STATUSES,
} from "./domain.js";

/** ISO calendar date `YYYY-MM-DD` (matches Drizzle `date` columns). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected date in YYYY-MM-DD format");

const committeeType = z.enum(COMMITTEE_TYPES as unknown as [string, ...string[]]);
const memberRole = z.enum(MEMBER_ROLES as unknown as [string, ...string[]]);
const votingRule = z.enum(VOTING_RULES as unknown as [string, ...string[]]);
const meetingFrequency = z.enum(MEETING_FREQUENCIES as unknown as [string, ...string[]]);
const membershipStatus = z.enum(MEMBERSHIP_STATUSES as unknown as [string, ...string[]]);

// ─── Quorum rule config ────────────────────────────────────────────────────────

/**
 * Quorum rule config schema (Req 2.3). At least one of `minMembers` / `minPercentage`
 * must be supplied; when both are present the stricter applies at evaluation time.
 * `roleComposition` maps member role → minimum quorum-eligible count. `vcCountsForQuorum`
 * is required so the VC-inclusion decision is always explicit.
 */
export const quorumRuleSchema = z
  .object({
    minMembers: z.number().int().positive().optional(),
    minPercentage: z.number().int().min(1).max(100).optional(),
    roleComposition: z.record(z.string().min(1), z.number().int().nonnegative()).optional(),
    vcCountsForQuorum: z.boolean(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.minMembers === undefined && rule.minPercentage === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "quorum rule must specify minMembers and/or minPercentage",
        path: ["minMembers"],
      });
    }
  });

export type QuorumRuleInput = z.infer<typeof quorumRuleSchema>;

// ─── Committee create / update ───────────────────────────────────────────────

export const createCommitteeBody = z.object({
  name:                  z.string().min(1).max(256),
  code:                  z.string().min(1).max(32).optional(),
  type:                  committeeType,
  termsOfReference:      z.string().optional(),
  termsOfReferenceUrl:   z.string().url().optional(),
  constitutionDate:      isoDate,
  tenureEnd:             isoDate.optional(),
  parentBodyId:          z.string().uuid().optional(),
  constitutingAuthority: z.string().max(512).optional(),
  quorumRule:            quorumRuleSchema,
  votingRule:            votingRule.default("simple_majority"),
  meetingFrequency:      meetingFrequency.optional(),
  statutoryBasis:        z.string().optional(),
});
export type CreateCommitteeBody = z.infer<typeof createCommitteeBody>;

/** Partial update — every field optional; `quorumRule` is replaced wholesale when present. */
export const updateCommitteeBody = z
  .object({
    name:                  z.string().min(1).max(256),
    code:                  z.string().min(1).max(32),
    type:                  committeeType,
    termsOfReference:      z.string(),
    termsOfReferenceUrl:   z.string().url(),
    tenureEnd:             isoDate,
    parentBodyId:          z.string().uuid(),
    constitutingAuthority: z.string().max(512),
    quorumRule:            quorumRuleSchema,
    votingRule:            votingRule,
    meetingFrequency:      meetingFrequency,
    statutoryBasis:        z.string(),
    status:                z.enum(["active", "dissolved", "superseded"]),
  })
  .partial();
export type UpdateCommitteeBody = z.infer<typeof updateCommitteeBody>;

// ─── Membership add / update ─────────────────────────────────────────────────

export const addMemberBody = z.object({
  memberId:            z.string().uuid(),
  role:                memberRole,
  appointmentDate:     isoDate,
  tenureEnd:           isoDate.optional(),
  appointingAuthority: z.string().max(512).optional(),
  votingRight:         z.boolean().default(true),
});
export type AddMemberBody = z.infer<typeof addMemberBody>;

export const updateMemberBody = z
  .object({
    role:                memberRole,
    tenureEnd:           isoDate,
    appointingAuthority: z.string().max(512),
    votingRight:         z.boolean(),
    status:              membershipStatus,
  })
  .partial();
export type UpdateMemberBody = z.infer<typeof updateMemberBody>;

// ─── Terms-of-reference revision (versioned history, Req 2.7) ───────────────────

export const addTermsRevisionBody = z.object({
  termsOfReference: z.string().min(1),
  effectiveDate:    isoDate,
});
export type AddTermsRevisionBody = z.infer<typeof addTermsRevisionBody>;

// ─── Query / path params ─────────────────────────────────────────────────────

export const committeeQueryParams = z.object({
  type:   committeeType.optional(),
  status: z.enum(["active", "dissolved", "superseded"]).optional(),
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type CommitteeQueryParams = z.infer<typeof committeeQueryParams>;

export const committeeIdParam = z.object({ committeeId: z.string().uuid() });
export const memberIdParam = z.object({
  committeeId: z.string().uuid(),
  memberId:    z.string().uuid(),
});
