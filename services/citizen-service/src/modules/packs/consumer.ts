import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as catalogueRepo from "../catalogue/repo.js";
import * as packRepo from "./repo.js";

const AUDIT = "audit.event.record";

export function registerPacksConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.packServiceImport, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      packId: string;
      packKey: string;
      name: string;
      servicePattern?: string;
      feeModel?: string;
      hoaCode?: string;
      statutoryReferences?: unknown[];
      manifest?: Record<string, unknown>;
      domainPackKey?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const pack = await packRepo.findServicePackById(p.packId, msg.tenantId);
      if (!pack) return;

      const serviceKey = `${p.packKey.replace(/^pack:/, "")}-${randomSuffix()}`;
      const next = (await catalogueRepo.latestVersionForKey(tx, msg.tenantId, serviceKey)) + 1;

      await catalogueRepo.insertDefinition(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        serviceKey,
        name: p.name,
        servicePattern: (p.servicePattern as never) ?? "certificate",
        feeModel: (p.feeModel as never) ?? null,
        hoaCode: p.hoaCode ?? null,
        statutoryReferences: (p.statutoryReferences ?? pack.statutoryReferences) as never,
        version: next,
        status: "draft",
        channels: ["portal", "counter"] as never,
        requiredDocuments: defaultDocumentsForPattern(p.servicePattern ?? "certificate"),
        forms: [],
        outputs: [],
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "citizen", action: "pack_import", resourceType: "service_definition",
          resourceId: p.id, outcome: "success", packKey: p.packKey,
        },
      });
    });
  });
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function defaultDocumentsForPattern(pattern: string): { docType: string; label: string; mandatory: boolean }[] {
  if (pattern === "grievance") return [];
  return [{ docType: "id_proof", label: "Identity proof", mandatory: true }];
}
