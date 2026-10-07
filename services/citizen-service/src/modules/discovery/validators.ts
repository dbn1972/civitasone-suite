import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";

export const idParam = z.object({ id: z.string().uuid() });

export const grantConsentBody = z.object({
  citizenId: z.string().uuid(),
  scope:     safeText({ max: 48 }).default("benefit_discovery"),
  // GAP-CITIZEN-DISCOVERY-01: DPDP consent evidence. Additive + optional so no
  // existing caller breaks; when present they are persisted with the grant so
  // the record shows HOW consent was obtained (channel), WHY (purpose) and
  // against WHICH notice version. The actor + timestamp are already captured
  // from the request context / event envelope.
  purpose:       safeText({ max: 500, multiline: true }).optional(),
  channel:       z.enum(["in_person", "otp", "e_sign"]).optional(),
  noticeVersion: safeText({ max: 32 }).optional(),
});
export type GrantConsentBody = z.infer<typeof grantConsentBody>;

export const revokeConsentBody = z.object({
  citizenId: z.string().uuid(),
  scope:     safeText({ max: 48 }).default("benefit_discovery"),
});
export type RevokeConsentBody = z.infer<typeof revokeConsentBody>;

export const runDiscoveryBody = z.object({
  citizenId: z.string().uuid(),
  scope:     safeText({ max: 48 }).default("benefit_discovery"),
  profile:   z.record(z.unknown()).default({}),
  recipient: safeText({ max: 128 }).optional(),
});
export type RunDiscoveryBody = z.infer<typeof runDiscoveryBody>;

export const enrolBody = z.object({
  serviceType: safeText({ max: 128 }).optional(),
});
export type EnrolBody = z.infer<typeof enrolBody>;
