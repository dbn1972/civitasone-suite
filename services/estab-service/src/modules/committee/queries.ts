import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { MeetingRow } from "./schema.js";

export async function getMeetingsByCommittee(tenantId: string, committeeId: string): Promise<MeetingRow[]> {
  const result = await cache.getOrLoad<MeetingRow[]>(
    cache.makeKey(tenantId, "committee_meetings", committeeId),
    () => repo.findMeetingsByCommittee(committeeId, tenantId)
  );
  return result ?? [];
}
