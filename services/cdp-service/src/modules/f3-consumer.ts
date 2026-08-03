// @ts-nocheck — F3 leftover consumer for cdp route writes
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../shared/db.js";
import { cache } from "../shared/infra.js";
import { enqueue, markProcessed } from "../shared/outbox.js";
import { COMMANDS, EVENTS } from "../topics.js";
import * as scoresRepo from "./profiles/scores-repo.js";
import * as templateRepo from "./profiles/template-repo.js";
import * as profilesRepo from "./profiles/repo.js";
import * as deviceRepo from "./identity/device-repo.js";
import * as taxonomyRepo from "./events/taxonomy-repo.js";
import * as visitorRepo from "./identity/visitor-repo.js";
import * as identityRepo from "./identity/repo.js";
import * as eventsRepo from "./events/repo.js";
import * as nameKeyRepo from "./identity/name-key-repo.js";
import { hashIdentifier } from "./identity/domain.js";
import { ANONYMOUS_PROFILE_TYPE } from "./identity/stitch-domain.js";

const log = pino({ name: "cdp-f3-consumer" });
const VISITOR_IDENTIFIER_TYPE = "visitorId";

export function registerF3CdpConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "score_upsert", "template_create", "template_update", "template_apply",
      "device_link", "taxonomy_create", "taxonomy_update", "taxonomy_approve",
      "visitor_track", "visitor_touch", "visitor_stitch",
    ]);
    if (!ops.has(op)) return;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "score_upsert": {
            const existing = p.existing as { id: string; version: number } | null;
            if (existing) {
              const ok = await scoresRepo.updateScore(tx, existing.id, p.tenantId as string, existing.version, {
                score: p.score as string,
                modelVersion: p.modelVersion as string,
                computedAt: new Date(p.computedAt as string),
              });
              if (!ok) return;
            } else {
              await scoresRepo.insert(tx, {
                id: p.id as string,
                tenantId: p.tenantId as string,
                profileId: p.profileId as string,
                scoreType: p.scoreType as string,
                score: p.score as string,
                modelVersion: p.modelVersion as string,
                computedAt: new Date(p.computedAt as string),
              });
            }
            await enqueue(tx, {
              topic: EVENTS.scoreUpserted,
              eventType: EVENTS.scoreUpserted,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { profileId: p.profileId, scoreType: p.scoreType, score: p.score, modelVersion: p.modelVersion },
            });
            await enqueue(tx, {
              topic: "audit.event.record",
              eventType: "audit.event.record",
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: {
                service: "cdp",
                action: existing ? "profile_score_updated" : "profile_score_created",
                resourceType: "profile_score",
                resourceId: p.id,
                outcome: "success",
                metadata: { profileId: p.profileId, scoreType: p.scoreType, modelVersion: p.modelVersion },
              },
            });
            break;
          }
          case "template_create": {
            await templateRepo.insert(tx, {
              id: p.id as string,
              tenantId: p.tenantId as string,
              vertical: p.vertical as string,
              profileType: p.profileType as string,
              label: p.label as string,
              attributesSpec: p.attributes as Array<Record<string, unknown>>,
              conflictRules: p.conflictRules as Record<string, Record<string, unknown>>,
              defaultStrategy: p.defaultStrategy as string,
              sourcePriority: p.sourcePriority as string[],
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
            await enqueue(tx, {
              topic: EVENTS.profileTemplateCreated,
              eventType: EVENTS.profileTemplateCreated,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { templateId: p.id, vertical: p.vertical, profileType: p.profileType, attributeCount: (p.attributes as unknown[]).length },
            });
            await enqueue(tx, {
              topic: "audit.event.record",
              eventType: "audit.event.record",
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { service: "cdp", action: "profile_template_created", resourceType: "profile_template", resourceId: p.id, outcome: "success", metadata: { vertical: p.vertical, profileType: p.profileType } },
            });
            break;
          }
          case "template_update": {
            const ok = await templateRepo.update(tx, p.id as string, p.tenantId as string, p.patch as never, p.version as number);
            if (!ok) return;
            await enqueue(tx, {
              topic: EVENTS.profileTemplateUpdated,
              eventType: EVENTS.profileTemplateUpdated,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { templateId: p.id, vertical: p.vertical, changed: p.changed },
            });
            await enqueue(tx, {
              topic: "audit.event.record",
              eventType: "audit.event.record",
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { service: "cdp", action: "profile_template_updated", resourceType: "profile_template", resourceId: p.id, outcome: "success", metadata: { vertical: p.vertical } },
            });
            break;
          }
          case "template_apply": {
            const ok = await profilesRepo.update(tx, p.profileId as string, p.tenantId as string, {
              attributes: p.attributes,
              sourceLineage: p.sourceLineage,
              updatedBy: msg.actorId,
            }, p.version as number);
            if (!ok) return;
            await enqueue(tx, {
              topic: EVENTS.profileTemplateApplied,
              eventType: EVENTS.profileTemplateApplied,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { profileId: p.profileId, templateId: p.templateId, vertical: p.vertical, resolved: p.resolved, ignoredAttributes: p.ignoredAttributes },
            });
            await enqueue(tx, {
              topic: "audit.event.record",
              eventType: "audit.event.record",
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { service: "cdp", action: "profile_template_applied", resourceType: "profile", resourceId: p.profileId, outcome: "success", metadata: { templateId: p.templateId, vertical: p.vertical, attributeCount: (p.resolved as unknown[]).length } },
            });
            break;
          }
          case "device_link": {
            if (p.relink) {
              const ok = await deviceRepo.relink(tx, p.existingId as string, p.tenantId as string, p.existingVersion as number, {
                profileId: p.profileId as string,
                deviceType: p.deviceType as string,
                lastSeenAt: new Date(p.seenAt as string),
              });
              if (!ok) return;
            } else {
              await deviceRepo.insert(tx, {
                id: p.id as string,
                tenantId: p.tenantId as string,
                profileId: p.profileId as string,
                deviceToken: p.deviceToken as string,
                deviceType: p.deviceType as string,
                lastSeenAt: new Date(p.seenAt as string),
              });
            }
            await enqueue(tx, {
              topic: EVENTS.deviceLinked,
              eventType: EVENTS.deviceLinked,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { deviceId: p.id, profileId: p.profileId, deviceType: p.deviceType, relinked: p.relink },
            });
            await enqueue(tx, {
              topic: "audit.event.record",
              eventType: "audit.event.record",
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { service: "cdp", action: p.relink ? "device_relinked" : "device_linked", resourceType: "device_token", resourceId: p.id, outcome: "success", metadata: { profileId: p.profileId, deviceType: p.deviceType } },
            });
            break;
          }
          case "taxonomy_create": {
            await taxonomyRepo.insert(tx, {
              id: p.id as string,
              tenantId: p.tenantId as string,
              eventName: p.eventName as string,
              category: p.category as string,
              schemaJson: p.schemaJson as Record<string, unknown>,
              status: "draft",
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
            await enqueue(tx, {
              topic: EVENTS.taxonomyCreated,
              eventType: EVENTS.taxonomyCreated,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { taxonomyId: p.id, eventName: p.eventName, category: p.category },
            });
            await enqueue(tx, {
              topic: "audit.event.record",
              eventType: "audit.event.record",
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { service: "cdp", action: "event_taxonomy_created", resourceType: "event_taxonomy", resourceId: p.id, outcome: "success", metadata: { eventName: p.eventName, category: p.category } },
            });
            break;
          }
          case "taxonomy_update": {
            const ok = await taxonomyRepo.update(tx, p.id as string, p.tenantId as string, p.patch as never, p.version as number);
            if (!ok) return;
            await enqueue(tx, {
              topic: EVENTS.taxonomyUpdated,
              eventType: EVENTS.taxonomyUpdated,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { taxonomyId: p.id, eventName: p.eventName, patch: p.patch },
            });
            await enqueue(tx, {
              topic: "audit.event.record",
              eventType: "audit.event.record",
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { service: "cdp", action: "event_taxonomy_updated", resourceType: "event_taxonomy", resourceId: p.id, outcome: "success", metadata: { eventName: p.eventName } },
            });
            break;
          }
          case "taxonomy_approve": {
            const ok = await taxonomyRepo.update(tx, p.id as string, p.tenantId as string, { status: "approved", updatedBy: msg.actorId }, p.version as number);
            if (!ok) return;
            await enqueue(tx, {
              topic: EVENTS.taxonomyApproved,
              eventType: EVENTS.taxonomyApproved,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { taxonomyId: p.id, eventName: p.eventName },
            });
            await enqueue(tx, {
              topic: "audit.event.record",
              eventType: "audit.event.record",
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { service: "cdp", action: "event_taxonomy_approved", resourceType: "event_taxonomy", resourceId: p.id, outcome: "success", metadata: { eventName: p.eventName } },
            });
            break;
          }
          case "visitor_track": {
            const seenAt = new Date(p.seenAt as string);
            await profilesRepo.insert(tx, {
              id: p.anonymousProfileId as string,
              tenantId: p.tenantId as string,
              profileType: ANONYMOUS_PROFILE_TYPE,
              attributes: p.attributes,
              sourceLineage: p.sourceLineage,
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
            await identityRepo.insert(tx, {
              tenantId: p.tenantId as string,
              profileId: p.anonymousProfileId as string,
              identifierType: VISITOR_IDENTIFIER_TYPE,
              identifierHash: p.visitorKeyHash as string,
              confidence: "0.6000",
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
            await visitorRepo.insert(tx, {
              id: p.id as string,
              tenantId: p.tenantId as string,
              visitorKeyHash: p.visitorKeyHash as string,
              anonymousProfileId: p.anonymousProfileId as string,
              status: "anonymous",
              deviceType: p.deviceType as string,
              firstSeenAt: seenAt,
              lastSeenAt: seenAt,
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
            await enqueue(tx, {
              topic: EVENTS.visitorTracked,
              eventType: EVENTS.visitorTracked,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { visitorId: p.id, anonymousProfileId: p.anonymousProfileId, deviceType: p.deviceType },
            });
            await enqueue(tx, {
              topic: "audit.event.record",
              eventType: "audit.event.record",
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { service: "cdp", action: "anonymous_visitor_tracked", resourceType: "anonymous_visitor", resourceId: p.id, outcome: "success", metadata: { anonymousProfileId: p.anonymousProfileId, deviceType: p.deviceType } },
            });
            break;
          }
          case "visitor_touch": {
            await visitorRepo.touch(tx, p.id as string, p.tenantId as string, {
              lastSeenAt: new Date(p.seenAt as string),
              deviceType: p.deviceType as string,
              updatedBy: msg.actorId,
            });
            break;
          }
          case "visitor_stitch": {
            const eventsMerged = await eventsRepo.reassignProfile(tx, p.anonymousProfileId as string, p.knownProfileId as string, p.tenantId as string);
            const identifiersMerged = await identityRepo.reassignProfile(tx, p.anonymousProfileId as string, p.knownProfileId as string, p.tenantId as string);
            const devicesMerged = await deviceRepo.reassignProfile(tx, p.anonymousProfileId as string, p.knownProfileId as string, p.tenantId as string);
            await nameKeyRepo.deleteByProfile(tx, p.anonymousProfileId as string, p.tenantId as string);
            await profilesRepo.markMerged(tx, p.knownProfileId as string, p.anonymousProfileId as string, p.tenantId as string, p.attributes, p.sourceLineage, p.mergedFromIds as string[]);
            const claimed = await visitorRepo.markMerged(tx, p.visitorId as string, p.tenantId as string, {
              mergedIntoProfileId: p.knownProfileId as string,
              eventsMerged,
              identifiersMerged,
              devicesMerged,
              mergedAt: new Date(p.mergedAt as string),
              updatedBy: msg.actorId,
            }, p.version as number);
            if (!claimed) return;
            await enqueue(tx, {
              topic: EVENTS.visitorStitched,
              eventType: EVENTS.visitorStitched,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { visitorId: p.visitorId, anonymousProfileId: p.anonymousProfileId, knownProfileId: p.knownProfileId, eventsMerged, identifiersMerged, devicesMerged },
            });
            await enqueue(tx, {
              topic: EVENTS.profilesMerged,
              eventType: EVENTS.profilesMerged,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { winnerId: p.knownProfileId, loserId: p.anonymousProfileId, reason: "anonymous_stitch" },
            });
            await enqueue(tx, {
              topic: EVENTS.lineageAppended,
              eventType: EVENTS.lineageAppended,
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { profileId: p.knownProfileId, entry: p.lineageEntry },
            });
            await enqueue(tx, {
              topic: "audit.event.record",
              eventType: "audit.event.record",
              tenantId: msg.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: { service: "cdp", action: "anonymous_visitor_stitched", resourceType: "anonymous_visitor", resourceId: p.visitorId, outcome: "success", metadata: { anonymousProfileId: p.anonymousProfileId, knownProfileId: p.knownProfileId, eventsMerged, identifiersMerged, devicesMerged } },
            });
            break;
          }
        }
      });
      if (op === "score_upsert") {
        await cache.invalidate(cache.makeKey(msg.tenantId, "profile_summary", p.profileId as string));
      }
      if (op === "device_link") {
        await cache.invalidate(cache.makeKey(msg.tenantId, "profile_summary", p.profileId as string));
      }
      if (op === "template_apply" || op === "visitor_stitch") {
        await cache.invalidate(cache.makeKey(msg.tenantId, "profile", p.profileId as string ?? p.knownProfileId as string));
        await cache.invalidate(cache.makeKey(msg.tenantId, "profile_lineage", p.knownProfileId as string));
        await cache.invalidate(cache.makeKey(msg.tenantId, "profile_summary", p.knownProfileId as string));
      }
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
