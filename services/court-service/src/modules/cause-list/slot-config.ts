import { HttpError } from "../../shared/context.js";
import * as configRepo from "../config-registry/repo.js";
import { effectiveAllowed } from "../config-registry/domain.js";
import { slotNamespace, courtroomNamespace, DEFAULT_SLOTS, DEFAULT_COURTROOMS } from "./domain.js";

/**
 * Owner decision #33: the slots / courtrooms a court may list cases on - its own active config entries
 * when it has any (AUTHORITATIVE, replaces the defaults), else the defaults.
 */
export type SlotConfig = { slots: Set<string>; courtrooms: Set<string> };

/** Pre-publish read (route / command path): uncached, tenant-scoped. */
export async function loadSlotConfig(tenantId: string, courtId: string): Promise<SlotConfig> {
  const [slots, rooms] = await Promise.all([
    configRepo.listByNamespace(tenantId, slotNamespace(courtId), true),
    configRepo.listByNamespace(tenantId, courtroomNamespace(courtId), true),
  ]);
  return {
    slots: effectiveAllowed(slots.map((e) => e.configKey), DEFAULT_SLOTS),
    courtrooms: effectiveAllowed(rooms.map((e) => e.configKey), DEFAULT_COURTROOMS),
  };
}

/** In-transaction read (consumer path), on the handler's own GUC-scoped connection. */
export async function loadSlotConfigTx(
  tx: Parameters<typeof configRepo.listActiveKeys>[0], tenantId: string, courtId: string,
): Promise<SlotConfig> {
  const [slots, rooms] = await Promise.all([
    configRepo.listActiveKeys(tx, tenantId, slotNamespace(courtId)),
    configRepo.listActiveKeys(tx, tenantId, courtroomNamespace(courtId)),
  ]);
  return {
    slots: effectiveAllowed(slots, DEFAULT_SLOTS),
    courtrooms: effectiveAllowed(rooms, DEFAULT_COURTROOMS),
  };
}

/** The first violation as an HttpError the route turns into a 422 the caller can act on. */
export function slotConfigViolation(cfg: SlotConfig, slot: string, courtroom: string): HttpError | null {
  if (!cfg.slots.has(slot)) {
    return new HttpError(422, "CAUSELIST_SLOT_NOT_CONFIGURED",
      `Slot ${slot} is not configured for this court. Allowed: ${[...cfg.slots].join(", ")}`);
  }
  if (!cfg.courtrooms.has(courtroom)) {
    return new HttpError(422, "CAUSELIST_COURTROOM_NOT_CONFIGURED",
      `Courtroom ${courtroom} is not configured for this court. Allowed: ${[...cfg.courtrooms].join(", ")}`);
  }
  return null;
}
