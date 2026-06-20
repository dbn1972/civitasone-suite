/**
 * Command handlers (WRITE PATH).
 * Rule (CLAUDE.md §6): NO Postgres writes here. Validate → publish command → prime cache
 * (read-your-writes) → return the new id. The consumer does the durable DB write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateContactBody } from "./validators.js";
import type { ContactView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createContact(ctx: RequestContext, body: CreateContactBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: ContactView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    email: body.email ?? null,
    phone: body.phone ?? null,
    company: body.company ?? null,
    status: "active",
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);

  await queue.publish(COMMANDS.createContact, {
    messageId: id,
    type: COMMANDS.createContact,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
