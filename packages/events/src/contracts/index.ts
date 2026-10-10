/**
 * FF-02 WP1 — @civitasone/events/contracts barrel.
 *
 * The event-contract foundation (D-18): defineContract, the in-house zod schema
 * walker + compatibility diff, the mode resolver and the PII-safe error
 * formatter. Exposed as the "./contracts" subpath export (package.json) so
 * every service imports the SAME definitions as the producer and consumer.
 */
export {
  defineContract,
  getContract,
  listContracts,
  resetContracts,
  ContractDefinitionError,
  type Contract,
  type ContractKind,
  type ContractVisibility,
  type ContractDelivery,
  type DefineContractInput,
  type ValidationResult,
} from "./define.js";

export {
  walkSchema,
  diffSchemas,
  SchemaWalkerError,
  type SchemaNode,
} from "./walker.js";

export {
  resolveMode,
  modeEnvFromProcess,
  type ContractMode,
  type ContractModeEnv,
} from "./modes.js";

export {
  formatContractViolation,
  violationRecordIsPiiSafe,
  ContractViolationError,
  type ViolationCode,
  type ViolationIssue,
  type ViolationRecord,
} from "./errors.js";

// ─── SmartTransfer / Workforce Core contract pack C0 (ST-M01-06, D-ST-19) ────
// Every `smarttransfer.*` and `hrms.posting.*` topic, defined in mode enforce.
// Importing this registers them in the module-level contract registry.
export {
  smartTransferContractPack,
  smarttransferContracts,
  hrmsPostingContracts,
  TOPIC_BASE_MAX,
  topicDashForm,
  // smarttransfer.*
  smarttransferCycleCreated,
  smarttransferCycleFrozen,
  smarttransferCycleClosed,
  smarttransferRequestSubmitted,
  smarttransferRequestWithdrawn,
  smarttransferPreferenceSubmitted,
  smarttransferScenarioCreated,
  smarttransferRunRequested,
  smarttransferRunCompleted,
  smarttransferRunFailed,
  smarttransferAssignmentProposed,
  smarttransferSolveRequested,
  smarttransferSolveCompleted,
  smarttransferOrderDrafted,
  smarttransferOrderIssued,
  smarttransferOrderCancelled,
  smarttransferRelievingRecorded,
  smarttransferJoiningRecorded,
  smarttransferAppealSubmitted,
  smarttransferAppealDecided,
  smarttransferEvidenceRecorded,
  // hrms.posting.*
  hrmsPostingApply,
  hrmsPostingApplied,
  hrmsPostingChanged,
  hrmsPostingHoldPlaced,
  hrmsPostingHoldReleased,
} from "./smarttransfer/index.js";
