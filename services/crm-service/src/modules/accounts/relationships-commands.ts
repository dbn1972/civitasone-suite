/**
 * CM-002 account relationships — CQRS write path. create/delete keyed on the
 * relationship id (distinct messageIds via publishCrmCommand).
 */
import type { RequestContext } from "@civitasone/types";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand, type Accepted } from "../../shared/residual-publish.js";

export type { Accepted };

export const createAccountRelationship = (
  ctx: RequestContext,
  id: string,
  body: { fromAccountId: string; toAccountId: string; relType: string },
): Promise<Accepted> => publishCrmCommand(ctx, COMMANDS.createAccountRelationship, id, body);

export const deleteAccountRelationship = (
  ctx: RequestContext,
  id: string,
  body: { fromAccountId: string },
): Promise<Accepted> => publishCrmCommand(ctx, COMMANDS.deleteAccountRelationship, id, body);
