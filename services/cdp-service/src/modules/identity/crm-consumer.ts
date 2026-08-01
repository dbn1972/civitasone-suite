/**
 * identity/crm-consumer.ts — cross-service stitching for crm.contact.created /
 * crm.contact.updated (CONSUMED_EVENTS in topics.ts).
 *
 * crm-service owns these payloads, so every field is validated on read and every optional
 * field is tolerated when absent. A shape this service does not understand is a logged
 * skip, never a throw: throwing would retry the message three times and then dead-letter
 * it, and a publisher-side shape change would wedge the consumer for every tenant.
 *
 * PII: these payloads carry contact names, emails and phones. Nothing here logs a payload
 * value — only entity ids, identifier *types* and outcomes. Contact identifiers are
 * persisted as SHA-256 identity-graph edges rather than as profile attributes, because
 * this service's `profiles.attributes` column is not encrypted at rest (see report).
 */
import type { CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as profilesRepo from "../profiles/repo.js";
import { hashIdentifier, deterministicConfidence } from "./domain.js";

const log = pino({ name: "cdp-crm-consumer", level: process.env.LOG_LEVEL ?? "info" });

const AUDIT_TOPIC = "audit.event.record";
const CRM_SOURCE = "crm";
/** Identifier type under which a CRM contact id is stitched into the identity graph. */
const CRM_IDENTIFIER = "externalId";

/**
 * Fallback actor for a foreign event whose actorId is not a uuid. `created_by` is a
 * NOT NULL uuid, so a malformed actor must degrade to an attributable system id instead
 * of aborting the stitch.
 */
const SYSTEM_ACTOR = "00000000-0000-4000-8000-000000000000";

/**
 * Only `contactId` is guaranteed by the publisher today; crm sends `name` on create and
 * nothing else on update. The rest are accepted because the cross-service contract allows
 * the publisher to add optional fields, and a consumer must handle both payload
 * generations during a rollout.
 */
const contactSchema = z.object({
  contactId: z.string().uuid(),
  name: z.string().min(1).max(256).optional(),
  email: z.string().email().max(320).optional(),
  phone: z.string().min(4).max(32).optional(),
  city: z.string().min(1).max(128).optional(),
  company: z.string().min(1).max(256).optional(),
  country: z.string().min(2).max(64).optional(),
});

export type CrmContactPayload = z.infer<typeof contactSchema>;

/** Descriptive attributes that may be copied onto a golden profile. */
const ATTRIBUTE_KEYS = ["name", "city", "company", "country"] as const;

/** Identifier-bearing fields, stored hashed in the identity graph rather than in attributes. */
const IDENTIFIER_KEYS: ReadonlyArray<{ field: "email" | "phone"; type: string }> = [
  { field: "email", type: "email" },
  { field: "phone", type: "phone" },
];

interface EdgeSpec {
  type: string;
  hash: string;
}

function attributesFrom(p: CrmContactPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ATTRIBUTE_KEYS) {
    const value = p[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Hashed identifier edges derivable from the contact. Hashing goes through
 * `hashIdentifier` (identity/domain.ts) — the same normalise-then-SHA-256 used by
 * POST /v1/cdp/identity/resolve — so a contact's email resolves onto the profile an
 * event collector already created for that email. A second hashing scheme here would
 * silently never match.
 */
function identifierEdges(p: CrmContactPayload): EdgeSpec[] {
  const out: EdgeSpec[] = [];
  for (const { field, type } of IDENTIFIER_KEYS) {
    const value = p[field];
    if (value === undefined) continue;
    out.push({ type, hash: hashIdentifier(type, value) });
  }
  return out;
}

function actorOf(msg: CommandEnvelope<unknown>): string {
  return z.string().uuid().safeParse(msg.actorId).success ? msg.actorId : SYSTEM_ACTOR;
}

function parseOrSkip(msg: CommandEnvelope<unknown>, topic: string): CrmContactPayload | null {
  const parsed = contactSchema.safeParse(msg.payload);
  if (parsed.success) return parsed.data;
  // crm reuses crm.contact.created for bulk-import summaries ({ batchId, total, ... }),
  // which carry no contactId. Those land here and are skipped by design.
  log.warn(
    {
      messageId: msg.messageId,
      tenantId: msg.tenantId,
      topic,
      outcome: "skipped_unsupported_payload",
      issues: parsed.error.issues.map((i) => i.path.join(".") || "payload"),
    },
    "crm contact event not stitchable",
  );
  return null;
}

/** Lineage with a single, current entry for this CRM contact — replaced in place, not appended. */
function stampLineage(
  existing: ReadonlyArray<{ source: string; sourceId: string; timestamp: string }>,
  contactId: string,
): Array<{ source: string; sourceId: string; timestamp: string }> {
  return [
    ...existing.filter((e) => !(e.source === CRM_SOURCE && e.sourceId === contactId)),
    { source: CRM_SOURCE, sourceId: contactId, timestamp: new Date().toISOString() },
  ];
}

type CreateOutcome = "created" | "linked" | "already_linked" | "ambiguous" | "duplicate";

/** The golden profile a contact resolved onto, as read inside the handler's transaction. */
type MatchedProfile = NonNullable<Awaited<ReturnType<typeof profilesRepo.findByIdTx>>>;

interface CreateResult {
  outcome: CreateOutcome;
  profileId: string | null;
  /** Identifier *types* that matched an existing edge — never the values. */
  matchedOn: string[];
  candidateCount: number;
  lineageStamped: boolean;
}

interface UpdateResult {
  outcome: "updated" | "unmatched" | "conflict" | "duplicate";
  profileId: string | null;
}

/**
 * crm.contact.created → identity resolution.
 *
 * Deterministic only, in two steps:
 *  1. the contact id itself (an exact external key) — already stitched means no-op, which
 *     makes a replay of the whole CRM stream safe on top of the messageId gate;
 *  2. the contact's hashed email/phone against the identity graph — a CRM contact for
 *     somebody the CDP already knows must attach to that golden profile, not mint a
 *     second one.
 *
 * Probabilistic (name) matching is deliberately NOT attempted: a wrong link here merges
 * two people's data, and the steward merge queue exists for exactly that judgement call.
 */
export async function handleCrmContactCreated(msg: CommandEnvelope<unknown>): Promise<void> {
  const p = parseOrSkip(msg, "crm.contact.created");
  if (p === null) return;

  const actorId = actorOf(msg);
  const contactHash = hashIdentifier(CRM_IDENTIFIER, p.contactId);
  const newProfileId = randomUUID();

  // The outcome is the transaction's return value rather than a captured variable, so a
  // rolled-back transaction can never leave this handler logging (or cache-invalidating)
  // a write that did not happen.
  const result = await db.transaction(async (tx): Promise<CreateResult> => {
    // Idempotency gate — first statement. Without it a redelivery would mint a second
    // golden profile for the same contact.
    const fresh = await markProcessed(tx, msg.messageId);
    if (!fresh) return { outcome: "duplicate", profileId: null, matchedOn: [], candidateCount: 0, lineageStamped: true };

    const stitched = await repo.findByHashTx(tx, contactHash, msg.tenantId);
    const stitchedEdge = stitched[0];
    if (stitchedEdge !== undefined) {
      return {
        outcome: "already_linked",
        profileId: stitchedEdge.profileId,
        matchedOn: [CRM_IDENTIFIER],
        candidateCount: 1,
        lineageStamped: true,
      };
    }

    const edges = identifierEdges(p);

    // Deterministic resolution over the identity graph. `presentHashes` records which of
    // this contact's identifiers already exist as edges: (tenant, type, hash) is unique,
    // so those must not be re-inserted.
    const candidates = new Set<string>();
    const presentHashes = new Set<string>();
    for (const edge of edges) {
      const rows = await repo.findByHashTx(tx, edge.hash, msg.tenantId);
      for (const row of rows) {
        candidates.add(row.profileId);
        presentHashes.add(row.identifierHash);
      }
    }
    const matchedOn = edges.filter((e) => presentHashes.has(e.hash)).map((e) => e.type);

    if (candidates.size > 1) {
      // The email points at one profile and the phone at another. Linking either way, or
      // creating a third profile, all make the graph worse. Left for the steward.
      return { outcome: "ambiguous", profileId: null, matchedOn, candidateCount: candidates.size, lineageStamped: true };
    }

    const candidateId = [...candidates][0];
    let target: MatchedProfile | null = null;
    if (candidateId !== undefined) {
      const found = await profilesRepo.findByIdTx(tx, candidateId, msg.tenantId);
      // A merge reassigns edges to the winner, so an edge pointing at a merged (or
      // vanished) profile is stale. Creating a fresh profile beats attaching a live
      // contact to a loser row nothing reads.
      if (found !== null && found.profileType !== "merged") target = found;
    }

    const attributes = attributesFrom(p);

    if (target !== null) {
      // The contact id becomes a new exact key for the profile we already hold, plus any
      // identifier of this contact the graph did not have yet.
      await repo.insert(tx, {
        tenantId: msg.tenantId,
        profileId: target.id,
        identifierType: CRM_IDENTIFIER,
        identifierHash: contactHash,
        confidence: String(deterministicConfidence(CRM_IDENTIFIER)),
        createdBy: actorId,
        updatedBy: actorId,
      });
      for (const edge of edges) {
        if (presentHashes.has(edge.hash)) continue;
        await repo.insert(tx, {
          tenantId: msg.tenantId,
          profileId: target.id,
          identifierType: edge.type,
          identifierHash: edge.hash,
          confidence: String(deterministicConfidence(edge.type)),
          createdBy: actorId,
          updatedBy: actorId,
        });
      }

      // Provenance and CRM's view of the attributes, best-effort: an optimistic-lock miss
      // costs a lineage stamp that the next crm.contact.updated re-applies, whereas
      // abandoning the link would lose the resolution entirely.
      const lineageStamped = await profilesRepo.update(
        tx,
        target.id,
        msg.tenantId,
        {
          attributes: { ...target.attributes, ...attributes },
          sourceLineage: stampLineage(target.sourceLineage, p.contactId),
          updatedBy: actorId,
        },
        target.version,
      );

      await enqueue(tx, {
        topic: EVENTS.identityResolved,
        eventType: EVENTS.identityResolved,
        tenantId: msg.tenantId,
        actorId,
        correlationId: msg.correlationId,
        // Ids and identifier *types* only — never the identifier values.
        payload: {
          profileId: target.id,
          source: CRM_SOURCE,
          sourceId: p.contactId,
          outcome: "linked",
          matchedOn,
        },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "cdp",
          action: "profile_linked_from_crm",
          resourceType: "profile",
          resourceId: target.id,
          outcome: "success",
          metadata: {
            source: CRM_SOURCE,
            sourceId: p.contactId,
            matchedOn,
            attributeKeys: Object.keys(attributes),
          },
        },
      });

      return { outcome: "linked", profileId: target.id, matchedOn, candidateCount: candidates.size, lineageStamped };
    }

    await profilesRepo.insert(tx, {
      id: newProfileId,
      tenantId: msg.tenantId,
      profileType: "individual",
      attributes,
      sourceLineage: [{ source: CRM_SOURCE, sourceId: p.contactId, timestamp: new Date().toISOString() }],
      createdBy: actorId,
      updatedBy: actorId,
    });

    await repo.insert(tx, {
      tenantId: msg.tenantId,
      profileId: newProfileId,
      identifierType: CRM_IDENTIFIER,
      identifierHash: contactHash,
      confidence: String(deterministicConfidence(CRM_IDENTIFIER)),
      createdBy: actorId,
      updatedBy: actorId,
    });

    // Contact identifiers become additional hashed edges so a later ingest carrying the
    // same email or phone resolves onto this profile deterministically.
    for (const edge of edges) {
      await repo.insert(tx, {
        tenantId: msg.tenantId,
        profileId: newProfileId,
        identifierType: edge.type,
        identifierHash: edge.hash,
        confidence: String(deterministicConfidence(edge.type)),
        createdBy: actorId,
        updatedBy: actorId,
      });
    }

    await enqueue(tx, {
      topic: EVENTS.profileCreated,
      eventType: EVENTS.profileCreated,
      tenantId: msg.tenantId,
      actorId,
      correlationId: msg.correlationId,
      // A new golden profile is `cdp.profile.created`; `cdp.identity.resolved` is reserved
      // for the case where an identifier landed on a profile that already existed.
      payload: {
        profileId: newProfileId,
        profileType: "individual",
        source: CRM_SOURCE,
        sourceId: p.contactId,
        attributeKeys: Object.keys(attributes),
      },
    });

    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: msg.tenantId,
      actorId,
      correlationId: msg.correlationId,
      payload: {
        service: "cdp",
        action: "profile_stitched_from_crm",
        resourceType: "profile",
        resourceId: newProfileId,
        outcome: "success",
        metadata: { source: CRM_SOURCE, sourceId: p.contactId, attributeKeys: Object.keys(attributes) },
      },
    });

    return { outcome: "created", profileId: newProfileId, matchedOn, candidateCount: candidates.size, lineageStamped: true };
  });

  const { outcome, profileId } = result;

  if ((outcome === "created" || outcome === "linked") && profileId !== null) {
    await cache.invalidate(cache.makeKey(msg.tenantId, "profile", profileId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "profile_lineage", profileId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "profile_summary", profileId));
  }

  if (outcome === "ambiguous") {
    log.warn(
      {
        messageId: msg.messageId,
        tenantId: msg.tenantId,
        contactId: p.contactId,
        candidateCount: result.candidateCount,
        matchedOn: result.matchedOn,
        outcome,
      },
      "crm contact matches more than one profile — left for steward review",
    );
    return;
  }

  log.info(
    {
      messageId: msg.messageId,
      tenantId: msg.tenantId,
      contactId: p.contactId,
      profileId,
      matchedOn: result.matchedOn,
      lineageStamped: result.lineageStamped,
      outcome,
    },
    "crm contact created stitched",
  );
}

/**
 * crm.contact.updated → golden profile refresh.
 *
 * Two effects, both bounded: any descriptive attribute present in the payload is merged
 * (never removed — an absent field means "not reported", not "cleared"), and the CRM
 * lineage entry is re-stamped so provenance shows when CRM last spoke about this contact.
 * The lineage entry is replaced in place rather than appended, otherwise a chatty CRM
 * would grow the lineage array without bound.
 */
export async function handleCrmContactUpdated(msg: CommandEnvelope<unknown>): Promise<void> {
  const p = parseOrSkip(msg, "crm.contact.updated");
  if (p === null) return;

  const actorId = actorOf(msg);
  const contactHash = hashIdentifier(CRM_IDENTIFIER, p.contactId);

  const result = await db.transaction(async (tx): Promise<UpdateResult> => {
    // Idempotency gate — first statement. A redelivery must not bump the profile version
    // or re-stamp lineage a second time.
    const fresh = await markProcessed(tx, msg.messageId);
    if (!fresh) return { outcome: "duplicate", profileId: null };

    const edges = await repo.findByHashTx(tx, contactHash, msg.tenantId);
    const edge = edges[0];
    if (edge === undefined) {
      // Nothing stitched this contact yet (the create event may not have arrived, or
      // predates the consumer). Creating a profile here would race the create handler.
      return { outcome: "unmatched", profileId: null };
    }

    const profile = await profilesRepo.findByIdTx(tx, edge.profileId, msg.tenantId);
    if (!profile || profile.profileType === "merged") {
      return { outcome: "unmatched", profileId: edge.profileId };
    }

    const incoming = attributesFrom(p);

    const ok = await profilesRepo.update(
      tx,
      edge.profileId,
      msg.tenantId,
      {
        attributes: { ...profile.attributes, ...incoming },
        sourceLineage: stampLineage(profile.sourceLineage, p.contactId),
        updatedBy: actorId,
      },
      profile.version,
    );
    if (!ok) {
      // Optimistic-lock miss. Retrying is pointless once the message is marked processed,
      // and CRM will speak again on the next change, so this is a logged no-op.
      return { outcome: "conflict", profileId: edge.profileId };
    }

    await enqueue(tx, {
      topic: EVENTS.profileUpdated,
      eventType: EVENTS.profileUpdated,
      tenantId: msg.tenantId,
      actorId,
      correlationId: msg.correlationId,
      // Key names only, so a downstream log of this event cannot leak contact values.
      payload: { profileId: edge.profileId, source: CRM_SOURCE, sourceId: p.contactId, changedKeys: Object.keys(incoming) },
    });

    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: msg.tenantId,
      actorId,
      correlationId: msg.correlationId,
      payload: {
        service: "cdp",
        action: "profile_refreshed_from_crm",
        resourceType: "profile",
        resourceId: edge.profileId,
        outcome: "success",
        metadata: { source: CRM_SOURCE, sourceId: p.contactId, changedKeys: Object.keys(incoming) },
      },
    });

    return { outcome: "updated", profileId: edge.profileId };
  });

  const { outcome, profileId } = result;

  if (outcome === "updated" && profileId !== null) {
    await cache.invalidate(cache.makeKey(msg.tenantId, "profile", profileId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "profile_lineage", profileId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "profile_summary", profileId));
  }

  if (outcome === "unmatched") {
    // A contact that was never resolved is a normal state, not a failure: logging it at
    // ERROR would drown the real errors in a stream where most contacts predate the CDP.
    log.debug(
      { messageId: msg.messageId, tenantId: msg.tenantId, contactId: p.contactId, outcome },
      "crm contact has no golden profile — nothing to refresh",
    );
    return;
  }

  log.info(
    { messageId: msg.messageId, tenantId: msg.tenantId, contactId: p.contactId, profileId, outcome },
    "crm contact updated handled",
  );
}
