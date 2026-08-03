import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishAdminCommand, type Accepted } from "../../shared/f3-publish.js";
import { COMMANDS } from "../../topics.js";
import type { RecordDeadLetterInput } from "./service.js";

export type { Accepted };

export async function recordDeadLetterCmd(
  ctx: RequestContext,
  input: RecordDeadLetterInput,
): Promise<Accepted> {
  const id = randomUUID();
  return publishAdminCommand(ctx, COMMANDS.deadLetterRecord, id, {
    ...input,
    payload: (input.payload ?? {}) as Record<string, unknown>,
  });
}
