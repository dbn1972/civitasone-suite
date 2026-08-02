/**
 * visits/commands.ts — publishes visit check-in/check-out commands.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { VisitOutcome } from "./domain.js";

export type { Accepted };

export async function checkIn(
  ctx: RequestContext,
  body: { taskId: string; latitude: number; longitude: number; checkInAt: string },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.visitCheckIn, id, { id, ...body });
}

export async function checkOut(
  ctx: RequestContext,
  id: string,
  body: {
    taskId: string;
    checkOutAt: string;
    latitude: number | null;
    longitude: number | null;
    notes: string | null;
    photos: string[];
    durationMinutes: number;
    outcome: VisitOutcome;
    version: number;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.visitCheckOut, id, { id, ...body });
}
