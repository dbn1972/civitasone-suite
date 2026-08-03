import type { RequestContext } from "@civitasone/types";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand, type Accepted } from "../../shared/residual-publish.js";

export type { Accepted };

/**
 * Both commands are keyed on the role id, so they must NOT reuse it as the
 * queue messageId: the create already recorded that id in `_inbox.processed`,
 * and a delete carrying the same messageId is dropped as an already-processed
 * redelivery — the role stays in the table after a 202. `publishCrmCommand`
 * derives the messageId from `${type}:${id}`, which keeps the two apart.
 */
export const createContactRole = (
  ctx: RequestContext,
  id: string,
  body: { contactId: string; dealId: string; role: string },
): Promise<Accepted> => publishCrmCommand(ctx, COMMANDS.createContactRole, id, body);

export const deleteContactRole = (
  ctx: RequestContext,
  id: string,
  body: { contactId: string },
): Promise<Accepted> => publishCrmCommand(ctx, COMMANDS.deleteContactRole, id, body);
