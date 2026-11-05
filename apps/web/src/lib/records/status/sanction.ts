import type { StatusRule } from "../statusActions";

/**
 * UX-R5 / DS-3: budget sanction status rules, mirroring finance-service budget/domain.ts. The web contract
 * (SanctionDetailSchema) carries approved | pending | rejected (draft/pending_approval -> pending, cancelled -> rejected).
 * Only a pending sanction can be approved directly or raised to eOffice; approved and rejected are final.
 */
export const SANCTION_STATUS_RULE: StatusRule = {
  terminal: ["approved", "rejected", "exhausted", "cancelled"],
  raisable: ["pending", "draft", "pending_approval"],
};
