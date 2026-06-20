import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { AuditEventView } from "./domain.js";

export async function getEvent(tenantId: string, id: string): Promise<AuditEventView | null> {
  return cache.getOrLoad<AuditEventView>(cache.makeKey(tenantId, RESOURCE.event, id), () => repo.findById(id));
}

export async function listEvents(tenantId: string, from: Date, to: Date, type?: string, limit = 50, offset = 0): Promise<AuditEventView[]> {
  return repo.listEvents(tenantId, from, to, type, limit, offset);
}
