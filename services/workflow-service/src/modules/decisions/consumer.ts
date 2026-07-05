import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import { pino } from "pino";

const log = pino({ name: "workflow-decisions-consumer" });

export function registerDecisionConsumers(queue: Queue): void {
  // Currently a no-op placeholder — decision table deploy is synchronous via routes.
  // Future: async validation, cross-tenant template push, etc.
}
