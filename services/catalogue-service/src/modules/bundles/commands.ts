/**
 * bundles/commands.ts — publishes bundle + approval mutation commands. No DB writes.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function createBundle(
  ctx: RequestContext,
  body: {
    name: string;
    description: string | null;
    componentProductIds: string[];
    pricingApprovalRequired: boolean;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createBundle, id, { id, ...body });
}

export async function updateBundle(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateBundle, id, { id, version: body.version, patch: body.patch });
}

export async function deleteBundle(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.deleteBundle, id, { id, version });
}

export async function requestBundleApproval(
  ctx: RequestContext,
  bundleId: string,
  body: { pricingAmountMinor: string; currency: string; reason: string | null },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.requestBundleApproval, id, { id, bundleId, ...body });
}

export async function decideBundleApproval(
  ctx: RequestContext,
  approvalId: string,
  body: {
    bundleId: string;
    decision: "approved" | "rejected";
    reason: string | null;
    requestedBy: string;
    version: number;
    pricingAmountMinor: string | null;
    decidedAt: string;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.decideBundleApproval, approvalId, { approvalId, ...body });
}
