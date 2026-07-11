import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { caseParcels } from "./schema.js";
import * as repo from "./repo.js";

type AddParcelPayload = {
  id: string;
  caseId: string;
  tenantId: string;
  surveyNumber: string;
  khasraNumber?: string;
  khataNumber?: string;
  village: string;
  tehsil?: string;
  district?: string;
  areaSqm?: number;
  subjectType?: string;
  ownershipRef?: string;
  remarks?: string;
};

type UpdateParcelPayload = {
  parcelId: string;
  tenantId: string;
  areaSqm?: number;
  ownershipRef?: string;
  remarks?: string;
  active?: boolean;
  expectedVersion: number;
};

export function registerParcelConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Attach a parcel to a case. Idempotent on the deterministic parcel id.
  register<AddParcelPayload>(COMMANDS.addParcel, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await repo.insertParcel(tx, {
        id: p.id,
        tenantId: p.tenantId,
        caseId: p.caseId,
        surveyNumber: p.surveyNumber,
        khasraNumber: p.khasraNumber ?? null,
        khataNumber: p.khataNumber ?? null,
        village: p.village,
        tehsil: p.tehsil ?? null,
        district: p.district ?? null,
        // area_sqm is BIGINT (whole square metres); coerce the JSON number to BigInt.
        areaSqm: p.areaSqm !== undefined ? BigInt(p.areaSqm) : null,
        subjectType: p.subjectType ?? "land",
        ownershipRef: p.ownershipRef ?? null,
        remarks: p.remarks ?? null,
        active: true,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.parcelAdded,
        eventType: EVENTS.parcelAdded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        // BigInt is NOT JSON-serialisable — emit areaSqm as a string when present.
        payload: {
          parcelId: p.id,
          caseId: p.caseId,
          surveyNumber: p.surveyNumber,
          ...(p.areaSqm !== undefined ? { areaSqm: String(p.areaSqm) } : {}),
        },
      });
      await audit(tx, msg, "add", "court_parcel", p.id);
    });
  });

  // Update / soft-detach a parcel — version-guarded optimistic concurrency.
  register<UpdateParcelPayload>(COMMANDS.updateParcel, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const current = await repo.getParcelForUpdate(tx, p.tenantId, p.parcelId);
      if (!current) throw new NonRetryableError(`PARCEL_NOT_FOUND: ${p.parcelId}`);

      // No-op if the message carries no effective change (e.g. active already at
      // the requested target and no other field supplied).
      const changesActive = p.active !== undefined && p.active !== current.active;
      const changesOther =
        p.areaSqm !== undefined || p.ownershipRef !== undefined || p.remarks !== undefined;
      if (!changesActive && !changesOther) return;

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: parcel ${p.parcelId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }

      await versionedUpdate(tx, caseParcels, {
        id: p.parcelId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          ...(p.areaSqm !== undefined ? { areaSqm: BigInt(p.areaSqm) } : {}),
          ...(p.ownershipRef ? { ownershipRef: p.ownershipRef } : {}),
          ...(p.remarks ? { remarks: p.remarks } : {}),
          ...(p.active !== undefined ? { active: p.active } : {}),
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "parcel",
      });

      await enqueue(tx, {
        topic: EVENTS.parcelUpdated,
        eventType: EVENTS.parcelUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        // Never emit a raw BigInt — stringify areaSqm when it changed.
        payload: {
          parcelId: p.parcelId,
          ...(p.areaSqm !== undefined ? { areaSqm: String(p.areaSqm) } : {}),
          ...(p.active !== undefined ? { active: p.active } : {}),
        },
      });
      await audit(tx, msg, "update", "court_parcel", p.parcelId);
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
