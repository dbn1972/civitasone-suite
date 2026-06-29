/**
 * @civitasone/eoffice-sdk
 *
 * Typed client + contracts for deep cross-module integration with the
 * eOffice (estab-service) approval backbone. Any module — finance, HR,
 * procurement, grants, legal — can raise an eFile for formal, immutable,
 * auditable approval and receive the decision back asynchronously.
 *
 * Quick start (raise a file):
 *
 *   import { EOfficeClient } from "@civitasone/eoffice-sdk";
 *   const eOffice = new EOfficeClient({ baseUrl: ESTAB_URL, token });
 *   const { id, fileNo } = await eOffice.raiseFile({
 *     refType: "finance_sanction",
 *     refId: sanctionId,
 *     subject: "Sanction of ₹12,00,000 for road works",
 *     dept: "PWD",
 *     initiatedBy: officerId,
 *     currentWith: approverId,
 *     approvalChain: "finance.sanction.standard",
 *     initialNote: "Proposal for administrative approval...",
 *     context: { amountMinor: 1_200_000_00, hoa: "2059-01-001" },
 *   });
 *
 * Quick start (consume the decision in your worker):
 *
 *   import { callbackTopicFor, parseDecisionCallback } from "@civitasone/eoffice-sdk";
 *   queue.subscribe(callbackTopicFor("finance_sanction"), (msg) => {
 *     const r = parseDecisionCallback(msg.payload);
 *     if (r.ok && r.value.decision === "approved") { ... }
 *   });
 */

export {
  EOfficeClient,
  EOfficeError,
  type EOfficeClientOptions,
  type TokenProvider,
  type DecisionLogEntry,
} from "./client.js";

export {
  callbackTopicFor,
  callbackTopicsFor,
  parseDecisionCallback,
  type ParseCallbackResult,
} from "./callbacks.js";

export {
  onDecision,
  type DecisionHandlers,
  type DecisionDispatchResult,
} from "./decision-handler.js";

export {
  SOURCE_REF_TYPES,
  CLASSIFICATIONS,
  PRIORITIES,
  DECISIONS,
  MODULE_CALLBACK_TOPICS,
  DECISION_CONSUMED_REF_TYPES,
  isDecisionConsumed,
  ESTAB_FILE_FROM_MODULE_TOPIC,
  raiseFileInput,
  acceptedResult,
  fileByRefResult,
  decisionCallbackPayload,
  resolvedApproval,
  type SourceRefType,
  type Classification,
  type Priority,
  type Decision,
  type RaiseFileInput,
  type RaiseFileRequest,
  type AcceptedResult,
  type FileByRef,
  type DecisionCallback,
  type ResolvedApproval,
} from "./contracts.js";
