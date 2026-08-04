/**
 * AC-004 email/calendar linking — CQRS write path.
 *
 * DEFERRED (honest): no live OAuth token exchange, IMAP poll, or CalDAV sync is
 * performed anywhere in this service. `connectLinkedAccount` only records the
 * user's intent as status='pending'; a future connector process is what would
 * flip it to 'connected' and populate synced_items automatically. `linkSyncedItem`
 * is the manual/connector-agnostic way to attach an already-known external item
 * to a CRM record — the substrate the AC's "linked to relevant records" needs.
 */
import type { RequestContext } from "@civitasone/types";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand, type Accepted } from "../../shared/residual-publish.js";
import type { ConnectLinkedAccountBody, LinkSyncedItemBody } from "./validators.js";

export type { Accepted };

export const connectLinkedAccount = (
  ctx: RequestContext,
  id: string,
  body: ConnectLinkedAccountBody,
): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.connectLinkedAccount, id, {
    userId: ctx.actorId,
    provider: body.provider,
    externalEmail: body.externalEmail,
    scopes: body.scopes ?? [],
  });

export const disconnectLinkedAccount = (ctx: RequestContext, id: string): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.disconnectLinkedAccount, id, {});

export const linkSyncedItem = (
  ctx: RequestContext,
  id: string,
  body: LinkSyncedItemBody,
): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.linkSyncedItem, id, {
    linkedAccountId: body.linkedAccountId,
    kind: body.kind,
    externalId: body.externalId,
    subjectType: body.subjectType,
    subjectId: body.subjectId,
    occurredAt: body.occurredAt ?? new Date().toISOString(),
  });
