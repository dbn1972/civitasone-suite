import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishAdminCommand, type Accepted } from "../../shared/f3-publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export const createApiKey = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  publishAdminCommand(ctx, COMMANDS.apiKeyCreate, id, body);

export const rotateApiKey = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  publishAdminCommand(ctx, COMMANDS.apiKeyRotate, id, body);

export const revokeApiKey = (ctx: RequestContext, id: string) =>
  publishAdminCommand(ctx, COMMANDS.apiKeyRevoke, id, {});
