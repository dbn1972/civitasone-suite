import type { Queue } from "@civitasone/queue";
import { subscribeApply } from "../../shared/finance-command.js";
import { COMMANDS } from "../../topics.js";
import { applyIssue, applyTransition, type TransitionAction } from "./commands.js";
import type { IssueInstrumentBody } from "./validators.js";

/**
 * Cheque / DD lifecycle consumers: route -> command (fresh randomUUID messageId) -> consumer. Each handler is ONE
 * transaction: markProcessed + a guarded conditional write + the audit.event.record outbox row (see commands.ts
 * applyIssue / applyTransition). A business refusal (maker == checker, illegal transition, conflicting re-issue) is an
 * HttpError and dead-letters immediately instead of being retried.
 */
export function registerInstrumentsConsumers(queue: Queue): void {
  subscribeApply<IssueInstrumentBody>(queue, COMMANDS.instrumentIssue, async (tx, actor, p) => { await applyIssue(tx, actor, p); });
  subscribeApply<{ id: string; action: TransitionAction; reason?: string }>(
    queue, COMMANDS.instrumentTransition, async (tx, actor, p) => { await applyTransition(tx, actor, p); },
  );
}
