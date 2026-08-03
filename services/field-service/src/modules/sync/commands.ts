/**
 * sync/commands.ts — publishes offline-sync batch push commands.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { SyncOperation } from "./domain.js";

export type { Accepted };

export async function pushSync(ctx: RequestContext, operations: SyncOperation[]): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.syncPush, id, { id, operations });
}
