/**
 * products/commands.ts — publishes product mutation commands. No DB writes.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function createProduct(
  ctx: RequestContext,
  body: {
    name: string;
    description: string | null;
    lineId: string | null;
    familyId: string | null;
    parentId: string | null;
    lifecycleStatus: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    regulatoryMetadata: Record<string, unknown>;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createProduct, id, { id, ...body });
}

export async function updateProduct(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateProduct, id, { id, version: body.version, patch: body.patch });
}

export async function deleteProduct(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.deleteProduct, id, { id, version });
}

export async function recordProductAvailability(
  ctx: RequestContext,
  productId: string,
  body: {
    circleId: string | null;
    regionId: string | null;
    officeId: string | null;
    available: boolean;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.recordProductAvailability, id, { id, productId, ...body });
}

export async function openProductVersion(
  ctx: RequestContext,
  productId: string,
  body: { changeSummary: string; versionNumber: number },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.openProductVersion, id, { id, productId, ...body });
}

export async function submitProductVersion(
  ctx: RequestContext,
  versionId: string,
  body: { productId: string; versionNumber: number; version: number; submittedAt: string },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.submitProductVersion, versionId, { versionId, ...body });
}

export async function approveProductVersion(
  ctx: RequestContext,
  versionId: string,
  body: {
    productId: string;
    versionNumber: number;
    version: number;
    makerId: string;
    comment: string | null;
    approvedAt: string;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.approveProductVersion, versionId, { versionId, ...body });
}

export async function rejectProductVersion(
  ctx: RequestContext,
  versionId: string,
  body: {
    productId: string;
    versionNumber: number;
    version: number;
    makerId: string;
    reason: string;
    rejectedAt: string;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.rejectProductVersion, versionId, { versionId, ...body });
}

export async function transitionProductLifecycle(
  ctx: RequestContext,
  productId: string,
  body: {
    lifecycleId: string;
    fromState: string | null;
    toState: string;
    effectiveFrom: string;
    reason: string | null;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.transitionProductLifecycle, body.lifecycleId, { productId, ...body });
}

export async function upsertRegulatoryMetadata(
  ctx: RequestContext,
  productId: string,
  body: {
    rowId: string;
    created: boolean;
    version: number | null;
    regulation: string;
    complianceStatus: string;
    notes: string | null;
    validFrom: string | null;
    validUntil: string | null;
    reviewedAt: string | null;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.upsertRegulatoryMetadata, body.rowId, { productId, ...body });
}

export async function setProductAvailability(
  ctx: RequestContext,
  productId: string,
  body: {
    rows: Array<{
      id: string;
      circleCode: string | null;
      regionCode: string | null;
      officeCode: string | null;
      available: boolean;
      effectiveFrom: string;
      effectiveTo: string | null;
    }>;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.setProductAvailability, productId, { productId, ...body });
}

export async function createCrossSellRule(
  ctx: RequestContext,
  sourceProductId: string,
  body: {
    targetProductId: string;
    ruleType: string;
    priority: number;
    enabled: boolean;
    note: string | null;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createCrossSellRule, id, { id, sourceProductId, ...body });
}

export async function deleteCrossSellRule(
  ctx: RequestContext,
  ruleId: string,
  body: { sourceProductId: string; targetProductId: string; ruleType: string },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.deleteCrossSellRule, ruleId, { ruleId, ...body });
}

export async function classifyProduct(
  ctx: RequestContext,
  productId: string,
  body: { productCode: string; category: string; taxRateBps: number; version: number },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.classifyProduct, productId, { productId, ...body });
}
