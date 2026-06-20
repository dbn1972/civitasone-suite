import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { SessionView } from "./domain.js";

export async function getSession(tenantId: string, id: string): Promise<SessionView | null> {
  return cache.getOrLoad<SessionView>(cache.makeKey(tenantId, RESOURCE.session, id), () => repo.findById(id));
}
