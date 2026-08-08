import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
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

/** Import a service pack as a new draft catalogue definition (FN-09). */
export async function importServicePack(ctx: RequestContext, packId: string): Promise<Accepted> {
  const pack = await repo.findServicePackById(packId, ctx.tenantId);
  if (!pack) throw new HttpError(404, "NOT_FOUND", "service pack not found");

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
