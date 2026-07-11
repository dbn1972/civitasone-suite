/**
 * visitor-service: group-visit command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern).
 *
 * `groupVisitCreate` publishes the full member list (with blind-indexed
 * identity doc hashes) so the consumer can screen each member and generate
 * individual Digital_Passes for non-blacklisted members (Requirement 9.2,
 * 9.5).
 *
 * `groupBulkCheckIn` publishes the group-lead QR scan event so the consumer
 * can bulk-transition member passes to checked-in state and reconcile the
 * headcount (Requirement 9.6).
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { identityDocHash } from "../blacklist/blind-index.js";

export type Accepted = { id: string; status: string; correlationId: string };

// ── groupVisitCreate ────────────────────────────────────────────────────────

export interface GroupMemberInput {
  name: string;
  identityDocType?: string | null;
  /** Raw document number — hashed here; never persisted or logged in cleartext. */
  identityDocNumber?: string | null;
}

export interface GroupVisitCreateInput {
  groupName: string;
  purpose: string;
  locationId: string;
  hostEmployeeId: string;
  leadVisitorName: string;
  leadVisitorPhone: string;
  leadVisitorEmail?: string | null;
  leadVisitorDocType?: string | null;
  leadVisitorDocNumber?: string | null;
  members: GroupMemberInput[];
  scheduledAt?: string | null; // ISO timestamp
  passType?: string | null; // defaults to "single"
  permittedAreas?: string[];
}

/**
 * Publishes `visitor.group_visit.create` command. The consumer creates the
 * group + member rows, a single visit request (linked via groupVisitId),
 * and individual Digital_Passes per non-blacklisted member (Requirement
 * 9.1, 9.2, 9.4, 9.5).
 */
export async function groupVisitCreate(ctx: RequestContext, input: GroupVisitCreateInput): Promise<Accepted> {
  const id = randomUUID();

  // Pre-compute blind indexes for each member so the consumer never sees cleartext
  const membersWithHashes = input.members.map((m) => ({
    name: m.name,
    identityDocType: m.identityDocType ?? null,
    identityDocHash: m.identityDocNumber
      ? identityDocHash(m.identityDocNumber, m.identityDocType)
      : null,
  }));

  await queue.publish(COMMANDS.groupVisitCreate, {
    messageId: id,
    type: COMMANDS.groupVisitCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      groupName: input.groupName,
      purpose: input.purpose,
      locationId: input.locationId,
      hostEmployeeId: input.hostEmployeeId,
      leadVisitorName: input.leadVisitorName,
      leadVisitorPhone: input.leadVisitorPhone,
      leadVisitorEmail: input.leadVisitorEmail ?? null,
      leadVisitorDocType: input.leadVisitorDocType ?? null,
      leadVisitorDocHash: input.leadVisitorDocNumber
        ? identityDocHash(input.leadVisitorDocNumber, input.leadVisitorDocType)
        : null,
      members: membersWithHashes,
      scheduledAt: input.scheduledAt ?? null,
      passType: input.passType ?? "single",
      permittedAreas: input.permittedAreas ?? [],
    },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

// ── groupBulkCheckIn ────────────────────────────────────────────────────────

export interface GroupBulkCheckInInput {
  groupVisitId: string;
  /** Count of members physically present at the gate (confirmed by guard). */
  actualHeadcount: number;
  gateId?: string | null;
}

/**
 * Publishes `visitor.group_visit.bulk_check_in` command. The consumer
 * reconciles headcount and transitions eligible member passes to checked-in
 * state (Requirement 9.6).
 */
export async function groupBulkCheckIn(ctx: RequestContext, input: GroupBulkCheckInInput): Promise<Accepted> {
  const messageId = randomUUID();

  await queue.publish(COMMANDS.groupBulkCheckIn, {
    messageId,
    type: COMMANDS.groupBulkCheckIn,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      groupVisitId: input.groupVisitId,
      tenantId: ctx.tenantId,
      actualHeadcount: input.actualHeadcount,
      gateId: input.gateId ?? null,
    },
  });

  return { id: input.groupVisitId, status: "accepted", correlationId: ctx.correlationId };
}
