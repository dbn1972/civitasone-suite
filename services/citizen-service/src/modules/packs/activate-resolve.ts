import { randomUUID } from "node:crypto";
import * as repo from "./repo.js";
import { resolveActivationPackKeys } from "./domain.js";

export type ResolvedActivationDraft = {
  id: string;
  packId: string;
  packKey: string;
  name: string;
  servicePattern?: string | null;
  feeModel?: string | null;
  hoaCode?: string | null;
  statutoryReferences?: unknown[];
  manifest?: Record<string, unknown>;
  domainPackKey?: string | null;
};

export async function resolveDomainPackDrafts(
  tenantId: string,
  domainPackKey: string,
  requestedPackKeys?: string[],
  presetDraftIds?: string[],
): Promise<{ domainPackId: string; drafts: ResolvedActivationDraft[] } | null> {
  const domainPack = await repo.findDomainPackByKey(tenantId, domainPackKey);
  if (!domainPack) return null;

  const packKeys = resolveActivationPackKeys({
    domainPackKey: domainPack.domainPackKey,
    packKeys: domainPack.packKeys,
    manifest: domainPack.manifest,
  }, requestedPackKeys);

  if (packKeys.length === 0) return { domainPackId: domainPack.id, drafts: [] };

  const servicePacks = await repo.findServicePacksByKeys(tenantId, domainPackKey, packKeys);
  const byKey = new Map<string, (typeof servicePacks)[number]>();
  for (const sp of servicePacks) {
    if (!byKey.has(sp.packKey)) byKey.set(sp.packKey, sp);
  }

  const drafts: ResolvedActivationDraft[] = [];
  let i = 0;
  for (const key of packKeys) {
    const pack = byKey.get(key);
    if (!pack) continue;
    drafts.push({
      id: presetDraftIds?.[i] ?? randomUUID(),
      packId: pack.id,
      packKey: pack.packKey,
      name: pack.name,
      servicePattern: pack.servicePattern,
      feeModel: pack.feeModel,
      hoaCode: pack.hoaCode,
      statutoryReferences: pack.statutoryReferences,
      manifest: pack.manifest as Record<string, unknown>,
      domainPackKey: pack.domainPackKey ?? domainPackKey,
    });
    i += 1;
  }

  return { domainPackId: domainPack.id, drafts };
}
