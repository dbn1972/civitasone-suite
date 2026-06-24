import * as repo from "./repo.js";
import type { EmdRow, PbgRow } from "./schema.js";

function mapEmd(r: EmdRow) {
  return {
    id: r.id, emdNo: r.emdNo, vendorId: r.vendorId,
    tenderId: r.tenderId ?? undefined, bidId: r.bidId ?? undefined,
    amountMinor: r.amountMinor.toString(), currency: r.currency,
    instrument: r.instrument, status: r.status,
    forfeitReason: r.forfeitReason ?? undefined,
    collectedAt: r.collectedAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : undefined,
  };
}

function mapPbg(r: PbgRow) {
  return {
    id: r.id, pbgNo: r.pbgNo, vendorId: r.vendorId,
    poRef: r.poRef ?? undefined, tenderId: r.tenderId ?? undefined,
    amountMinor: r.amountMinor.toString(), currency: r.currency,
    instrument: r.instrument, status: r.status,
    validUntil: r.validUntil ? String(r.validUntil) : undefined,
    forfeitReason: r.forfeitReason ?? undefined,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : undefined,
  };
}

export async function listEmd(tenantId: string, limit: number, offset: number) {
  return (await repo.listEmdByTenant(tenantId, limit, offset)).map(mapEmd);
}
export async function getEmd(id: string, tenantId: string) {
  const r = await repo.findEmdById(id, tenantId);
  return r ? mapEmd(r) : null;
}
export async function listPbg(tenantId: string, limit: number, offset: number) {
  return (await repo.listPbgByTenant(tenantId, limit, offset)).map(mapPbg);
}
export async function getPbg(id: string, tenantId: string) {
  const r = await repo.findPbgById(id, tenantId);
  return r ? mapPbg(r) : null;
}
