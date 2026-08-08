import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as catalogueRepo from "../catalogue/repo.js";
import * as repo from "./repo.js";
import {
  buildExportedPackManifest,
  packKeyFromServiceKey,
  requiresStatutoryAcknowledgement,
} from "./manifest-export.js";
import { resolveDomainPackDrafts } from "./activate-resolve.js";

export type Accepted = { id: string; status: string; correlationId: string };

export type DomainPackActivateAccepted = Accepted & {
  domainPackKey: string;
  draftIds: string[];
  packKeys: string[];
};

async function publish(
  ctx: RequestContext, type: string, messageId: string, payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, tenantId: ctx.tenantId },
  });
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * FN-09 — export a published catalogue definition as a versioned service pack.
 * Imports always land as draft; export never auto-publishes the pack for other tenants.
 */
export async function exportServicePack(ctx: RequestContext, definitionId: string): Promise<Accepted> {
  const def = await catalogueRepo.findDefinitionById(definitionId, ctx.tenantId);
  if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
  if (def.status !== "published") {
    throw new HttpError(409, "NOT_PUBLISHED", "only published service definitions can be exported as packs");
  }

  const packId = randomUUID();
  const packKey = packKeyFromServiceKey(def.serviceKey);
  const manifest = buildExportedPackManifest(def);

  return publish(ctx, COMMANDS.packServiceExport, packId, {
    id: packId,
    definitionId: def.id,
    packKey,
    name: def.name,
    servicePattern: def.servicePattern,
    feeModel: def.feeModel,
    hoaCode: def.hoaCode,
    serviceDefinitionId: def.id,
    formId: def.formId,
    eligibilityRuleSetId: def.eligibilityRuleSetId,
    feeRefId: def.feeScheduleId,
    workflowDefinitionId: def.workflowDefinitionId,
    statutoryReferences: def.statutoryReferences ?? [],
    engineBindings: [],
    manifest,
  });
}

/** Import a service pack as a new draft catalogue definition (FN-09 / FN-29). */
export async function importServicePack(
  ctx: RequestContext,
  packId: string,
  opts: { acknowledgeStatutory?: boolean } = {},
): Promise<Accepted> {
  const pack = await repo.findServicePackById(packId, ctx.tenantId);
  if (!pack) throw new HttpError(404, "NOT_FOUND", "service pack not found");

  if (requiresStatutoryAcknowledgement(pack) && !opts.acknowledgeStatutory) {
    throw new HttpError(
      422,
      "STATUTORY_ACK_REQUIRED",
      "this pack carries statutory references — acknowledge them before import",
    );
  }

  const definitionId = randomUUID();
  return publish(ctx, COMMANDS.packServiceImport, definitionId, {
    id: definitionId,
    packId: pack.id,
    packKey: pack.packKey,
    name: pack.name,
    servicePattern: pack.servicePattern,
    feeModel: pack.feeModel,
    hoaCode: pack.hoaCode,
    statutoryReferences: pack.statutoryReferences,
    manifest: pack.manifest,
    domainPackKey: pack.domainPackKey,
    acknowledgeStatutory: opts.acknowledgeStatutory === true,
  });
}

/**
 * Activate a Domain Pack: import selected (or pilot) service packs as editable drafts (FN-17 / FN-20).
 * Never auto-publishes — drafts stay local for office review.
 */
export async function activateDomainPack(
  ctx: RequestContext,
  domainPackKey: string,
  requestedPackKeys?: string[],
): Promise<DomainPackActivateAccepted> {
  const resolved = await resolveDomainPackDrafts(ctx.tenantId, domainPackKey, requestedPackKeys);
  if (!resolved) throw new HttpError(404, "NOT_FOUND", "domain pack not found");
  if (resolved.drafts.length === 0) {
    throw new HttpError(400, "VALIDATION_FAILED", "domain pack has no service packs to activate");
  }

  const activationId = randomUUID();
  const drafts = resolved.drafts;
  const draftIds = drafts.map((d) => d.id);
  const packKeys = drafts.map((d) => d.packKey);

  const projected = {
    id: activationId,
    tenantId: ctx.tenantId,
    domainPackKey,
    domainPackId: resolved.domainPackId,
    packKeys,
    draftIds,
    status: "accepted",
  };

  // Read-your-writes: project activation + draft stubs for same-session catalogue GETs.
  await cache.put(cache.makeKey(ctx.tenantId, "domain_pack_activation", activationId), projected);
  for (const d of drafts) {
    // Project a catalogue-shaped draft so same-session GET succeeds (read-your-writes).
    await cache.put(cache.makeKey(ctx.tenantId, "catalogue", d.id), {
      id: d.id,
      tenantId: ctx.tenantId,
      serviceKey: `${d.packKey.replace(/^pack:/, "")}-pending`,
      serviceId: null,
      name: d.name,
      ownerDepartment: null,
      servicePattern: d.servicePattern ?? "certificate",
      ownerOfficeId: null,
      offeringOfficeIds: null,
      workflowDefinitionId: null,
      formId: null,
      feeModel: d.feeModel ?? null,
      hoaCode: d.hoaCode ?? null,
      statutoryReferences: d.statutoryReferences ?? [],
      version: 1,
      status: "draft",
      eligibilityRuleSetId: null,
      feeScheduleId: null,
      issuanceType: null,
      requiredDocuments: [],
      slaDays: null,
      channels: ["portal", "counter"],
      forms: [],
      outputs: [],
      submittedBy: null,
      publishedBy: null,
      publishedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      rowVersion: 1,
      packKey: d.packKey,
      domainPackKey,
    });
  }

  await publish(ctx, COMMANDS.packDomainActivate, activationId, {
    id: activationId,
    domainPackKey,
    domainPackId: resolved.domainPackId,
    packKeys,
    drafts,
  });

  return {
    id: activationId,
    status: "accepted",
    correlationId: ctx.correlationId,
    domainPackKey,
    draftIds,
    packKeys,
  };
}
