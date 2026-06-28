/**
 * onDecision — transport-agnostic helper that turns a raw eOffice decision
 * callback payload into typed handler calls. Each source module wraps this in
 * its own queue.subscribe + transactional/idempotency boundary, so the SDK
 * stays free of any queue/db dependency.
 *
 * Usage in a module worker:
 *
 *   import { callbackTopicFor, onDecision } from "@civitasone/eoffice-sdk";
 *
 *   const dispatch = onDecision({
 *     onApproved: async (cb) => { ...release / issue / effect... },
 *     onRejected: async (cb) => { ...cancel... },
 *     onReturned: async (cb) => { ...back to draft... },
 *   });
 *
 *   queue.subscribe(callbackTopicFor("procurement_po"), async (msg) => {
 *     await db.transaction(async (tx) => {
 *       if (!(await markProcessed(tx, msg.messageId))) return;
 *       await dispatch(msg.payload, tx); // tx is passed straight through
 *     });
 *   });
 */
import { parseDecisionCallback } from "./callbacks.js";
import type { DecisionCallback } from "./contracts.js";

export interface DecisionHandlers<Ctx = unknown> {
  onApproved?: (cb: DecisionCallback, ctx: Ctx) => void | Promise<void>;
  onRejected?: (cb: DecisionCallback, ctx: Ctx) => void | Promise<void>;
  onReturned?: (cb: DecisionCallback, ctx: Ctx) => void | Promise<void>;
  /** Called when the payload fails validation (default: ignore). */
  onInvalid?: (error: string) => void | Promise<void>;
}

export type DecisionDispatchResult =
  | { handled: true; decision: DecisionCallback["decision"] }
  | { handled: false; reason: "invalid" | "no_handler" };

/**
 * Build a dispatcher. The returned function parses the raw payload and routes
 * to the matching handler. `ctx` (e.g. a db transaction) is passed straight
 * through to the handler so the module owns the write boundary.
 */
export function onDecision<Ctx = unknown>(handlers: DecisionHandlers<Ctx>) {
  return async (rawPayload: unknown, ctx: Ctx): Promise<DecisionDispatchResult> => {
    const parsed = parseDecisionCallback(rawPayload);
    if (!parsed.ok) {
      await handlers.onInvalid?.(parsed.error);
      return { handled: false, reason: "invalid" };
    }
    const cb = parsed.value;
    const handler =
      cb.decision === "approved" ? handlers.onApproved
      : cb.decision === "rejected" ? handlers.onRejected
      : handlers.onReturned;
    if (!handler) return { handled: false, reason: "no_handler" };
    await handler(cb, ctx);
    return { handled: true, decision: cb.decision };
  };
}
