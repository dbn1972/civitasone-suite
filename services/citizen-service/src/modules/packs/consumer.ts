import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as catalogueRepo from "../catalogue/repo.js";
import * as packRepo from "./repo.js";
import { applyManifestToDefinition } from "./manifest-apply.js";

const AUDIT = "audit.event.record";

export function registerPacksConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.packServiceExport, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      definitionId: string;
      packKey: string;
      name: string;
      servicePattern?: string | null;
      feeModel?: string | null;
      hoaCode?: string | null;
      serviceDefinitionId?: string | null;
      formId?: string | null;
      eligibilityRuleSetId?: string | null;
      feeRefId?: string | null;
      workflowDefinitionId?: string | null;
      statutoryReferences?: unknown[];
      engineBindings?: unknown[];
      manifest?: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const next = (await packRepo.latestVersionForPackKey(tx, msg.tenantId, p.packKey)) + 1;
      await packRepo.insertServicePack(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        sourceTenantId: msg.tenantId,
        packKey: p.packKey,
        name: p.name,
        servicePattern: (p.servicePattern as never) ?? null,
        serviceDefinitionId: p.serviceDefinitionId ?? p.definitionId,
        formId: p.formId ?? null,
        eligibilityRuleSetId: p.eligibilityRuleSetId ?? null,
        feeModel: (p.feeModel as never) ?? null,
        feeRefId: p.feeRefId ?? null,
        workflowDefinitionId: p.workflowDefinitionId ?? null,
        hoaCode: p.hoaCode ?? null,
        engineBindings: (p.engineBindings ?? []) as never,
        statutoryReferences: (p.statutoryReferences ?? []) as never,
        manifest: (p.manifest ?? {}) as never,
        status: "published",
        version: next,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "citizen", action: "pack_export", resourceType: "service_pack",
          resourceId: p.id, outcome: "success", packKey: p.packKey,
          definitionId: p.definitionId,
        },
      });
    });
  });

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
      const pack = await packRepo.findServicePackByIdTx(tx, p.packId, msg.tenantId);
      if (!pack) return;

      const serviceKey = `${p.packKey.replace(/^pack:/, "")}-${randomSuffix()}`;
      const next = (await catalogueRepo.latestVersionForKey(tx, msg.tenantId, serviceKey)) + 1;

      const manifest = (p.manifest ?? pack.manifest) as Record<string, unknown> | undefined;
      await catalogueRepo.insertDefinition(tx, applyManifestToDefinition({
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
      }, p.packKey, manifest));

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
