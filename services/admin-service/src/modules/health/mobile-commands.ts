import type { RequestContext } from "@civitasone/types";
import { publishAdminCommand, type Accepted } from "../../shared/f3-publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export const recordMobileTelemetry = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  publishAdminCommand(ctx, COMMANDS.mobileTelemetryRecord, id, body);
