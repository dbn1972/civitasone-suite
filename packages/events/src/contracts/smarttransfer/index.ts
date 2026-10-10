/**
 * ST-M01-06 — SmartTransfer / Workforce Core contract pack C0 barrel.
 *
 * Importing this module registers (via `defineContract`) every `smarttransfer.*`
 * and `hrms.posting.*` topic in the module-level contract registry, in mode
 * **enforce** (D-ST-19). Re-exported from `@civitasone/events/contracts` so
 * producers and consumers import the SAME frozen definitions.
 *
 * Spec §11 (module integration), §19; decisions D-ST-19, D-ST-10, D-18.
 * Topic surface: `docs/smarttransfer/event-list.md` (PR #1974, ST-M01-05) —
 * keep in lockstep.
 */
export * from "./smarttransfer-topics.js";
export * from "./hrms-posting-topics.js";

import { smarttransferContracts } from "./smarttransfer-topics.js";
import { hrmsPostingContracts } from "./hrms-posting-topics.js";
import { TOPIC_BASE_MAX, topicDashForm } from "./common.js";

export { TOPIC_BASE_MAX, topicDashForm };

/**
 * The full SmartTransfer / Workforce Core C0 pack: every `smarttransfer.*` and
 * `hrms.posting.*` contract, in event-list order. Used by the contract tests
 * and available to the snapshot/manifest tooling.
 */
export const smartTransferContractPack = [
  ...smarttransferContracts,
  ...hrmsPostingContracts,
] as const;
