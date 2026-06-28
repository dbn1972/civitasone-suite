/**
 * Helpers for consuming eOffice decision callbacks in a source module's worker.
 */
import {
  MODULE_CALLBACK_TOPICS,
  decisionCallbackPayload,
  type SourceRefType,
  type DecisionCallback,
} from "./contracts.js";

/** Resolve the callback topic a given source ref type's decisions arrive on. */
export function callbackTopicFor(refType: SourceRefType): string {
  return MODULE_CALLBACK_TOPICS[refType];
}

/** All callback topics a service should subscribe to for the given ref types. */
export function callbackTopicsFor(refTypes: readonly SourceRefType[]): string[] {
  return [...new Set(refTypes.map((t) => MODULE_CALLBACK_TOPICS[t]))];
}

export type ParseCallbackResult =
  | { ok: true; value: DecisionCallback }
  | { ok: false; error: string };

/**
 * Safely parse an incoming decision callback payload. Use at the consume
 * boundary instead of casting.
 */
export function parseDecisionCallback(raw: unknown): ParseCallbackResult {
  const result = decisionCallbackPayload.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  };
}
