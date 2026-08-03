import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function attachCollateral(
  ctx: RequestContext,
  body: {
    recommendationId: string;
    collateralType: string;
    collateralRef: string;
    title: string;
    ordinal: number;
  },
): Promise<Accepted> {
  const linkId = randomUUID();
  return publishCommand(ctx, COMMANDS.collateralAttach, linkId, { linkId, ...body });
}

export async function detachCollateral(ctx: RequestContext, linkId: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.collateralDetach, linkId, { linkId });
}
