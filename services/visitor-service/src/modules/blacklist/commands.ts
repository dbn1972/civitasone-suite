/**
 * visitor-service: blacklist/watchlist command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern, per
 * structure.md). Each function computes the identity-document blind index
 * (never the raw document number) before publishing, so the consumer
 * (./consumer.ts) never has to see cleartext identity documents — only the
 * deterministic hash used for screening lookups (DPDP "Blind Index"
 * compliance note in design.md).
 *
 * No routes.ts exists yet for this module (Task 4.7) — these publishers are
 * the seam routes.ts will call once it is scaffolded.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { identityDocHash } from "./blind-index.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface BlacklistAddInput {
  personName: string;
  identityDocType?: string | null;
  /** Raw document number — hashed here via identityDocHash(); never persisted or logged in cleartext. */
  identityDocNumber?: string | null;
  reason: string;
  locationId?: string | null; // null = all locations
  effectiveFrom?: string | null; // ISO timestamp; consumer defaults to now() when absent
  expiresAt?: string | null; // ISO timestamp; null = never expires
}

/**
 * Maker step (Requirement 10.6): creates a new blacklist entry in `pending`
 * status. It remains blocked from screening until a DIFFERENT user approves
 * it via `blacklistApprove` (Property 18).
 */
export async function blacklistAdd(ctx: RequestContext, input: BlacklistAddInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.blacklistAdd, {
    messageId: id,
    type: COMMANDS.blacklistAdd,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      locationId: input.locationId ?? null,
      personName: input.personName,
      identityDocType: input.identityDocType ?? null,
      identityDocHash: input.identityDocNumber
        ? identityDocHash(input.identityDocNumber, input.identityDocType)
        : null,
      reason: input.reason,
      effectiveFrom: input.effectiveFrom ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface BlacklistApproveInput {
  entryId: string;
}

/**
 * Checker step (Requirement 10.6): approves a `pending` blacklist entry,
 * transitioning it to `active`. The consumer enforces (under
 * `domain.ts#assertDistinctMakerChecker`) that the approver differs from the
 * entry's creator — self-approval is rejected (Property 18).
 */
export async function blacklistApprove(ctx: RequestContext, input: BlacklistApproveInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.blacklistApprove, {
    messageId,
    type: COMMANDS.blacklistApprove,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: input.entryId, tenantId: ctx.tenantId },
  });
  return { id: input.entryId, status: "accepted", correlationId: ctx.correlationId };
}

export interface BlacklistDeactivateInput {
  entryId: string;
}

/**
 * Fix 3: lifts an `active` blacklist entry, transitioning it to `archived`
 * (a valid transition per domain.ts#VALID_TRANSITIONS) and removing its
 * hash from the live Redis screening set so the block stops applying
 * immediately. Same maker-checker rigor as `blacklistApprove`: the consumer
 * rejects if the deactivating actor is the same as the entry's original
 * creator (Property 18 — segregation of duties applies symmetrically to
 * granting AND lifting a block).
 */
export async function blacklistDeactivate(ctx: RequestContext, input: BlacklistDeactivateInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.blacklistDeactivate, {
    messageId,
    type: COMMANDS.blacklistDeactivate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: input.entryId, tenantId: ctx.tenantId },
  });
  return { id: input.entryId, status: "accepted", correlationId: ctx.correlationId };
}

export interface WatchlistAddInput {
  personName: string;
  identityDocType?: string | null;
  /** Raw document number — hashed here via identityDocHash(); never persisted or logged in cleartext. */
  identityDocNumber?: string | null;
  riskLevel?: "low" | "medium" | "high";
  specialInstructions?: string | null;
  locationId?: string | null; // null = all locations
}

/**
 * Watchlist entries do not require maker-checker approval (Requirement
 * 10.5/10.2) — they are active immediately and only attach a visible
 * security flag rather than blocking entry.
 */
export async function watchlistAdd(ctx: RequestContext, input: WatchlistAddInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.watchlistAdd, {
    messageId: id,
    type: COMMANDS.watchlistAdd,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      locationId: input.locationId ?? null,
      personName: input.personName,
      identityDocType: input.identityDocType ?? null,
      identityDocHash: input.identityDocNumber
        ? identityDocHash(input.identityDocNumber, input.identityDocType)
        : null,
      riskLevel: input.riskLevel ?? "medium",
      specialInstructions: input.specialInstructions ?? null,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
