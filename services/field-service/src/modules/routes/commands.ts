/**
 * routes/commands.ts — publishes route-plan mutation commands.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { RouteScore } from "./domain.js";

export type { Accepted };

export interface CreateRouteInput {
  assigneeId: string;
  routeDate: string;
  waypoints: Array<Record<string, unknown>>;
  optimizedOrder: number[];
  score: RouteScore;
}

export async function createRoute(ctx: RequestContext, body: CreateRouteInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.routeCreate, id, { id, ...body });
}

export async function reorderRoute(
  ctx: RequestContext,
  id: string,
  body: { optimizedOrder: number[]; version: number },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.routeReorder, id, { id, optimizedOrder: body.optimizedOrder, version: body.version });
}
