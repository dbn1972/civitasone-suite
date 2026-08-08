import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as catalogueRepo from "../catalogue/repo.js";
import * as packRepo from "./repo.js";
import { applyManifestToDefinition } from "./manifest-apply.js";
import { resolveDomainPackDrafts } from "./activate-resolve.js";

const AUDIT = "audit.event.record";

type ImportDraftPayload = {
  id: string;
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

export function registerPacksConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.packServiceImport, async (msg) => {
    const p = msg.payload as ImportDraftPayload & { tenantId: string };
    let importedId: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await importOneDraft(tx, msg.tenantId, msg.actorId, msg.correlationId, p);
      if (ok) importedId = p.id;
    });
    if (importedId) await cache.invalidate(cache.makeKey(msg.tenantId, "catalogue", importedId));
  });

  /** FN-17 / FN-20 — activate Domain Pack → import multiple drafts in one command. */
  queue.subscribe(COMMANDS.packDomainActivate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      domainPackKey: string;
      domainPackId?: string;
      packKeys?: string[];
      drafts?: ImportDraftPayload[];
    };

    let drafts = p.drafts ?? [];
    let domainPackId = p.domainPackId ?? p.id;
    if (drafts.length === 0 && p.domainPackKey) {
      const resolved = await resolveDomainPackDrafts(
        msg.tenantId, p.domainPackKey, p.packKeys, undefined,
      );
      if (resolved) {
        domainPackId = resolved.domainPackId;
        drafts = resolved.drafts as ImportDraftPayload[];
      }
    }

    const imported: string[] = [];
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      for (const draft of drafts) {
        const ok = await importOneDraft(tx, msg.tenantId, msg.actorId, msg.correlationId, draft, {
          skipAudit: true,
        });
        if (ok) imported.push(draft.id);
      }

      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "citizen", action: "domain_pack_activate", resourceType: "domain_pack",
          resourceId: domainPackId, outcome: imported.length > 0 ? "success" : "noop",
          domainPackKey: p.domainPackKey, draftIds: imported, packCount: imported.length,
        },
      });
    });

    for (const id of imported) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "catalogue", id));
    }
  });
}

async function importOneDraft(
  tx: Parameters<typeof enqueue>[0],
  tenantId: string,
  actorId: string,
  correlationId: string,
  p: ImportDraftPayload,
  opts?: { skipAudit?: boolean },
): Promise<boolean> {
  const writer = tx as catalogueRepo.Writer;
  const pack = await packRepo.findServicePackByIdTx(writer as typeof db, p.packId, tenantId);
  if (!pack) return false;

  const serviceKey = `${p.packKey.replace(/^pack:/, "")}-${randomSuffix()}`;
  const next = (await catalogueRepo.latestVersionForKey(writer, tenantId, serviceKey)) + 1;

  const manifest = (p.manifest ?? pack.manifest) as Record<string, unknown> | undefined;
  await catalogueRepo.insertDefinition(writer, applyManifestToDefinition({
    id: p.id,
    tenantId,
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
    createdBy: actorId,
    updatedBy: actorId,
  }, p.packKey, manifest));

  if (!opts?.skipAudit) {
    await enqueue(tx, {
      topic: AUDIT, eventType: AUDIT,
      tenantId, actorId, correlationId,
      payload: {
        service: "citizen", action: "pack_import", resourceType: "service_definition",
        resourceId: p.id, outcome: "success", packKey: p.packKey,
      },
    });
  }
  return true;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function defaultDocumentsForPattern(pattern: string): { docType: string; label: string; mandatory: boolean }[] {
  if (pattern === "grievance") return [];
  return [{ docType: "id_proof", label: "Identity proof", mandatory: true }];
}
