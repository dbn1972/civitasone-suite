/**
 * committee module — SQS/RabbitMQ consumer handlers (CQRS write side, Req 2.1–2.7).
 *
 * Every handler follows the mandatory pattern (steering: Concurrency & Data Integrity):
 *   1. ONE `db.transaction()` per message.
 *   2. `markProcessed(tx, msg.messageId)` FIRST — if it returns false the message was
 *      already processed, so we skip (idempotency; P30).
 *   3. Business write (INSERT, or optimistic-locked `versionedUpdate`).
 *   4. Emit domain EVENTS + an audit event via the transactional outbox (same tx, so
 *      "DB committed ⇒ event delivered" with no dual-write hole).
 *   5. AFTER commit, invalidate the read-through cache.
 *
 * Tenure handling (Req 2.4): on member add/update we re-evaluate the member's tenure
 * against today using the pure domain helpers (`isTenureExpired`, `isTenureExpiring`)
 * and emit `committee.member_expired` (already lapsed) or `committee.tenure_expiring`
 * (within the 30-day advance-notice window). The daily cron (task 20.3) drives the
 * same evaluation across the whole roster; this keeps a just-edited member correct
 * immediately without waiting for the next cron tick.
 *
 * Registration: `registerCommitteeConsumers(register)` maps each committee COMMANDS
 * topic to its handler. worker.ts (task 19.1) passes its `registerConsumer` here.
 */
import { and, eq } from "drizzle-orm";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { committees, committeeMembers } from "./schema.js";
import { getAllowedCommitteeTypes } from "../config-registry/policy.js";
import {
  assertValidQuorumRule,
  assertMembershipTransition,
  isMembershipStatus,
  isTenureExpired,
  isTenureExpiring,
  type MembershipStatus,
  type QuorumRule,
} from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const CACHE_RESOURCE = "committee";

// ─── Command payload contracts (mirror topics.ts JSDoc) ────────────────────────

interface CommitteeCreatePayload {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  code?: string;
  termsOfReference?: string;
  termsOfReferenceUrl?: string;
  constitutionDate: string;
  tenureEnd?: string;
  parentBodyId?: string;
  constitutingAuthority?: string;
  quorumRule: QuorumRule;
  votingRule?: string;
  meetingFrequency?: string;
  statutoryBasis?: string;
}

interface CommitteeUpdatePayload {
  committeeId: string;
  version: number;
  patch: {
    name?: string;
    code?: string;
    type?: string;
    termsOfReference?: string;
    termsOfReferenceUrl?: string;
    tenureEnd?: string;
    parentBodyId?: string;
    constitutingAuthority?: string;
    quorumRule?: QuorumRule;
    votingRule?: string;
    meetingFrequency?: string;
    statutoryBasis?: string;
    status?: string;
  };
}

interface MemberAddPayload {
  membershipId: string;
  committeeId: string;
  tenantId: string;
  memberId: string;
  role: string;
  appointmentDate: string;
  tenureEnd?: string;
  appointingAuthority?: string;
  votingRight?: boolean;
}

interface MemberUpdatePayload {
  committeeId: string;
  membershipId: string;
  version: number;
  patch: {
    role?: string;
    tenureEnd?: string | null;
    votingRight?: boolean;
    status?: MembershipStatus;
  };
}

interface MemberRemovePayload {
  committeeId: string;
  membershipId: string;
  version: number;
  reason?: string;
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

/** Today's date as an ISO `YYYY-MM-DD` string (matches the `date` columns). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type Tx = Parameters<typeof enqueue>[0];
type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

/** Emit an audit fact for every mutation (steering: audit on every mutation). */
async function audit(tx: Tx, msg: MsgMeta, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: SERVICE, action, resourceType: "committee_member", resourceId, outcome: "success" },
  });
}

/**
 * Re-evaluate a membership's tenure against today and emit the appropriate advance /
 * expiry event (Req 2.4). Open-ended tenure (`tenureEnd === null`) emits nothing.
 * `expired` takes precedence over `expiring` for an already-lapsed tenure.
 */
async function emitTenureEvents(
  tx: Tx,
  msg: MsgMeta,
  args: { committeeId: string; membershipId: string; memberId: string; tenureEnd: string | null },
): Promise<void> {
  const today = todayIso();
  if (isTenureExpired(args.tenureEnd, today)) {
    await enqueue(tx, {
      topic: EVENTS.committeeMemberExpired,
      eventType: EVENTS.committeeMemberExpired,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        committeeId: args.committeeId,
        membershipId: args.membershipId,
        memberId: args.memberId,
        expiredOn: args.tenureEnd,
      },
    });
  } else if (isTenureExpiring(args.tenureEnd, today)) {
    await enqueue(tx, {
      topic: EVENTS.committeeTenureExpiring,
      eventType: EVENTS.committeeTenureExpiring,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        committeeId: args.committeeId,
        membershipId: args.membershipId,
        memberId: args.memberId,
        tenureEnd: args.tenureEnd,
      },
    });
  }
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/** committee.create → INSERT committee + emit `committee.created`. */
async function handleCommitteeCreate(msg: CommandEnvelope<CommitteeCreatePayload>): Promise<void> {
  const p = msg.payload;
  // Defence-in-depth: the route validator already checked this, but a malformed
  // quorum rule is a permanent error — reject it to the DLQ rather than retrying.
  try {
    assertValidQuorumRule(p.quorumRule);
  } catch (err) {
    throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
  }

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    // Tenant-configurable permitted committee types (config-registry,
    // meeting_committee_types). effectiveAllowed: unconfigured ⇒ the full default
    // set {standing, ad_hoc, statutory, board} ⇒ identical behavior. A tenant that
    // has restricted its permitted types rejects a disallowed type to the DLQ.
    const allowedTypes = await getAllowedCommitteeTypes(tx, msg.tenantId);
    if (!allowedTypes.has(p.type)) {
      throw new NonRetryableError(
        `COMMITTEE_TYPE_NOT_PERMITTED: committee type '${p.type}' is not in this tenant's permitted set`,
      );
    }
    await tx.insert(committees).values({
      id: p.id,
      tenantId: p.tenantId,
      name: p.name,
      code: p.code ?? null,
      type: p.type,
      termsOfReference: p.termsOfReference ?? null,
      termsOfReferenceUrl: p.termsOfReferenceUrl ?? null,
      constitutionDate: p.constitutionDate,
      tenureEnd: p.tenureEnd ?? null,
      parentBodyId: p.parentBodyId ?? null,
      constitutingAuthority: p.constitutingAuthority ?? null,
      quorumRule: p.quorumRule,
      votingRule: p.votingRule ?? "simple_majority",
      meetingFrequency: p.meetingFrequency ?? null,
      statutoryBasis: p.statutoryBasis ?? null,
      status: "active",
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.committeeCreated,
      eventType: EVENTS.committeeCreated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { committeeId: p.id, name: p.name, type: p.type },
    });
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { service: SERVICE, action: "create", resourceType: "committee", resourceId: p.id, outcome: "success" },
    });
  });

  await cache.invalidate(cache.makeKey(msg.tenantId, CACHE_RESOURCE, p.id));
  await cache.invalidateResource(msg.tenantId, CACHE_RESOURCE);
}

/** committee.update → optimistic-locked UPDATE + emit `committee.updated`. */
async function handleCommitteeUpdate(msg: CommandEnvelope<CommitteeUpdatePayload>): Promise<void> {
  const p = msg.payload;
  if (p.patch.quorumRule !== undefined) {
    try {
      assertValidQuorumRule(p.patch.quorumRule);
    } catch (err) {
      throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
    }
  }

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    // Build the SET from only the provided patch fields (undefined-safe under
    // exactOptionalPropertyTypes) so we never overwrite a column with undefined.
    const set: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
    for (const [k, v] of Object.entries(p.patch)) {
      if (v !== undefined) set[k] = v;
    }
    await versionedUpdate(tx, committees, {
      id: p.committeeId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set,
      entity: "committee",
    });
    await enqueue(tx, {
      topic: EVENTS.committeeUpdated,
      eventType: EVENTS.committeeUpdated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { committeeId: p.committeeId },
    });
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { service: SERVICE, action: "update", resourceType: "committee", resourceId: p.committeeId, outcome: "success" },
    });
  });

  await cache.invalidate(cache.makeKey(msg.tenantId, CACHE_RESOURCE, p.committeeId));
  await cache.invalidateResource(msg.tenantId, CACHE_RESOURCE);
}

/** committee.member_add → validate no duplicate active + INSERT + emit `member_added`. */
async function handleMemberAdd(msg: CommandEnvelope<MemberAddPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    // Req 2.2: a member may hold at most one ACTIVE membership on a committee.
    // A duplicate is a permanent rejection — do not retry.
    const existing = await tx
      .select({ id: committeeMembers.id })
      .from(committeeMembers)
      .where(
        and(
          eq(committeeMembers.tenantId, msg.tenantId),
          eq(committeeMembers.committeeId, p.committeeId),
          eq(committeeMembers.memberId, p.memberId),
          eq(committeeMembers.status, "active"),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new NonRetryableError(
        `member ${p.memberId} already has an active membership on committee ${p.committeeId}`,
      );
    }

    const tenureEnd = p.tenureEnd ?? null;
    await tx.insert(committeeMembers).values({
      id: p.membershipId,
      tenantId: p.tenantId,
      committeeId: p.committeeId,
      memberId: p.memberId,
      role: p.role,
      appointmentDate: p.appointmentDate,
      tenureEnd,
      appointingAuthority: p.appointingAuthority ?? null,
      votingRight: p.votingRight ?? true,
      status: "active",
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.committeeMemberAdded,
      eventType: EVENTS.committeeMemberAdded,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { committeeId: p.committeeId, memberId: p.memberId, role: p.role },
    });
    await emitTenureEvents(tx, msg, {
      committeeId: p.committeeId,
      membershipId: p.membershipId,
      memberId: p.memberId,
      tenureEnd,
    });
    await audit(tx, msg, "member_add", p.membershipId);
  });

  await cache.invalidate(cache.makeKey(msg.tenantId, CACHE_RESOURCE, p.committeeId));
  await cache.invalidateResource(msg.tenantId, CACHE_RESOURCE);
}

/** committee.member_update → validate transition + optimistic-locked UPDATE + tenure re-eval. */
async function handleMemberUpdate(msg: CommandEnvelope<MemberUpdatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const rows = await tx
      .select()
      .from(committeeMembers)
      .where(and(eq(committeeMembers.id, p.membershipId), eq(committeeMembers.tenantId, msg.tenantId)))
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new NonRetryableError(`committee membership ${p.membershipId} not found`);
    }

    // Validate a status transition against the domain state machine (Req 2.2).
    if (p.patch.status !== undefined && p.patch.status !== current.status) {
      if (!isMembershipStatus(current.status)) {
        throw new NonRetryableError(`membership ${p.membershipId} has unknown status "${current.status}"`);
      }
      try {
        assertMembershipTransition(current.status, p.patch.status);
      } catch (err) {
        throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
      }
    }

    const set: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
    if (p.patch.role !== undefined) set.role = p.patch.role;
    if (p.patch.tenureEnd !== undefined) set.tenureEnd = p.patch.tenureEnd;
    if (p.patch.votingRight !== undefined) set.votingRight = p.patch.votingRight;
    if (p.patch.status !== undefined) set.status = p.patch.status;

    await versionedUpdate(tx, committeeMembers, {
      id: p.membershipId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set,
      entity: "committee_member",
    });

    // Re-evaluate tenure with the effective end date (patched value wins).
    const effectiveTenureEnd =
      p.patch.tenureEnd !== undefined ? p.patch.tenureEnd : (current.tenureEnd ?? null);
    await emitTenureEvents(tx, msg, {
      committeeId: p.committeeId,
      membershipId: p.membershipId,
      memberId: current.memberId,
      tenureEnd: effectiveTenureEnd,
    });
    await audit(tx, msg, "member_update", p.membershipId);
  });

  await cache.invalidate(cache.makeKey(msg.tenantId, CACHE_RESOURCE, p.committeeId));
  await cache.invalidateResource(msg.tenantId, CACHE_RESOURCE);
}

/** committee.member_remove → soft status change to `removed` (never a hard delete). */
async function handleMemberRemove(msg: CommandEnvelope<MemberRemovePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const rows = await tx
      .select({ status: committeeMembers.status })
      .from(committeeMembers)
      .where(and(eq(committeeMembers.id, p.membershipId), eq(committeeMembers.tenantId, msg.tenantId)))
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new NonRetryableError(`committee membership ${p.membershipId} not found`);
    }
    if (!isMembershipStatus(current.status)) {
      throw new NonRetryableError(`membership ${p.membershipId} has unknown status "${current.status}"`);
    }
    try {
      assertMembershipTransition(current.status, "removed");
    } catch (err) {
      throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
    }

    await versionedUpdate(tx, committeeMembers, {
      id: p.membershipId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set: { status: "removed", updatedBy: msg.actorId, updatedAt: new Date() },
      entity: "committee_member",
    });
    await audit(tx, msg, "member_remove", p.membershipId);
  });

  await cache.invalidate(cache.makeKey(msg.tenantId, CACHE_RESOURCE, p.committeeId));
  await cache.invalidateResource(msg.tenantId, CACHE_RESOURCE);
}

// ─── Registration ──────────────────────────────────────────────────────────────

/** A single-topic consumer handler (matches worker.ts `ConsumerHandler`). */
type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
/** worker.ts `registerConsumer` shape — kept structural to avoid importing the worker. */
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;

/**
 * Register every committee command handler. worker.ts (task 19.1) calls this with its
 * `registerConsumer`, wiring the committee COMMANDS topics to the handlers above.
 */
export function registerCommitteeConsumers(register: RegisterConsumer): void {
  register(COMMANDS.committeeCreate, handleCommitteeCreate);
  register(COMMANDS.committeeUpdate, handleCommitteeUpdate);
  register(COMMANDS.committeeMemberAdd, handleMemberAdd);
  register(COMMANDS.committeeMemberUpdate, handleMemberUpdate);
  register(COMMANDS.committeeMemberRemove, handleMemberRemove);
}
