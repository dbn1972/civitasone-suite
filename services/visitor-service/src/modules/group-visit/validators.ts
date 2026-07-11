/**
 * visitor-service: group-visit zod validators (routes.ts boundary).
 *
 * Matches the shape of `GroupVisitCreateInput` / `GroupBulkCheckInInput` in
 * `./commands.ts`, following the same convention as
 * `modules/blacklist/validators.ts`.
 */
import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid("invalid id") });

const groupMemberBody = z.object({
  name: z.string().min(1, "member name is required").max(200, "member name must be 200 characters or fewer"),
  identityDocType: z.string().max(24, "identityDocType must be 24 characters or fewer").nullable().optional(),
  identityDocNumber: z.string().max(64, "identityDocNumber must be 64 characters or fewer").nullable().optional(),
});

export const groupVisitCreateBody = z.object({
  groupName: z.string().min(1, "groupName is required").max(200, "groupName must be 200 characters or fewer"),
  purpose: z.string().min(1, "purpose is required").max(2000, "purpose must be 2000 characters or fewer"),
  locationId: z.string().uuid("invalid locationId"),
  hostEmployeeId: z.string().uuid("invalid hostEmployeeId"),
  leadVisitorName: z.string().min(1, "leadVisitorName is required").max(200, "leadVisitorName must be 200 characters or fewer"),
  leadVisitorPhone: z.string().min(1, "leadVisitorPhone is required").max(20, "leadVisitorPhone must be 20 characters or fewer"),
  leadVisitorEmail: z.string().email("invalid email").max(254, "leadVisitorEmail must be 254 characters or fewer").nullable().optional(),
  leadVisitorDocType: z.string().max(24, "leadVisitorDocType must be 24 characters or fewer").nullable().optional(),
  leadVisitorDocNumber: z.string().max(64, "leadVisitorDocNumber must be 64 characters or fewer").nullable().optional(),
  members: z.array(groupMemberBody).min(2, "group must have at least 2 members").max(200, "group must have at most 200 members"),
  scheduledAt: z.string().datetime({ message: "scheduledAt must be an ISO timestamp" }).nullable().optional(),
  passType: z.enum(["single", "multi_day", "event"]).nullable().optional(),
  permittedAreas: z.array(z.string().uuid("invalid area id")).optional(),
});
export type GroupVisitCreateBody = z.infer<typeof groupVisitCreateBody>;

export const groupBulkCheckInBody = z.object({
  actualHeadcount: z.number().int("actualHeadcount must be an integer").min(1, "actualHeadcount must be at least 1").max(200, "actualHeadcount must be at most 200"),
  gateId: z.string().uuid("invalid gateId").nullable().optional(),
});
export type GroupBulkCheckInBody = z.infer<typeof groupBulkCheckInBody>;
