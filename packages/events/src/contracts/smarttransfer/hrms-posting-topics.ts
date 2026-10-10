/**
 * ST-M01-06 — `hrms.posting.*` contract pack C0 (enforce; D-ST-19).
 *
 * These are the Workforce Core posting topics. Producer and payload outlines
 * follow `docs/smarttransfer/event-list.md` (PR #1974, ST-M01-05) and must be
 * kept in lockstep with it.
 *
 * Ownership (D-ST-10, APPROVED): SmartTransfer never writes HRMS/Workforce Core
 * tables; it acts only through the `applyPosting` command. So:
 *   - `hrms.posting.apply` is a COMMAND whose producer is `smarttransfer-service`
 *     and whose single handler is `hrms-service` (the applyPosting consumer,
 *     ST-M01-09); the write happens inside hrms-service.
 *   - the `.applied` / `.changed` / `.hold_*` EVENTS are produced by `hrms-service`.
 *
 * v1-minimal fields whose downstream *consumer* depends on a PROPOSED decision
 * (the field is in the frozen contract regardless; tolerant reader):
 *   - `hrms.posting.changed` carries `station/state/cityClass/ddo` for the dated
 *     posting/DDO history planned in ST-M01-11; the PAYROLL consumer is OPEN
 *     D-ST-13. Today `hra_city_class` is unwritten (default "X"); no city-class
 *     value is invented here, the field is a plain string the producer fills.
 *   - the `.hold_placed` / `.hold_released` SmartTransfer eligibility consumer is
 *     OPEN D-ST-16. The holds themselves are produced by hrms-service.
 *
 * No `hrms.posting.*` payload carries money.
 */
import { z, zTenantId, zId, zWhen, zCode, defineStContract } from "./common.js";

const HRMS = "hrms-service";
const ST = "smarttransfer-service";

export const hrmsPostingApply = defineStContract({
  topic: "hrms.posting.apply",
  kind: "command",
  owner: ST, // SmartTransfer is the only caller; hrms-service handles it (D-ST-10)
  version: "1.0",
  consumers: [HRMS],
  schema: z.object({
    orderId: zId,
    tenantId: zTenantId,
    employeeId: zId,
    postId: zId,
    effectiveDate: zWhen,
    chargeType: zCode,
    orderNumber: z.string().min(1),
  }),
});

export const hrmsPostingApplied = defineStContract({
  topic: "hrms.posting.applied",
  kind: "event",
  owner: HRMS,
  version: "1.0",
  consumers: ["audit-service", ST],
  schema: z.object({
    orderId: zId,
    tenantId: zTenantId,
    employeeId: zId,
    postId: zId,
    chargeType: zCode,
    effectiveFrom: zWhen,
    orderNumber: z.string().min(1),
  }),
});

export const hrmsPostingChanged = defineStContract({
  topic: "hrms.posting.changed",
  kind: "event",
  owner: HRMS,
  version: "1.0",
  // payroll consumer is OPEN D-ST-13; estab (quarters/desks) and notification
  // consume it too (event-list). Adding a consumer later does not change the
  // contract (tolerant reader).
  consumers: ["audit-service", "estab-service", "notification-service"],
  schema: z.object({
    employeeId: zId,
    tenantId: zTenantId,
    fromOfficeId: zId,
    toOfficeId: zId,
    station: z.string().min(1),
    state: z.string().min(1),
    // v1-minimal: HRA city class (X/Y/Z). Source is OPEN D-ST-14; the field is
    // a plain string the producer fills, no classification is invented here.
    cityClass: zCode,
    ddo: zId,
    effectiveFrom: zWhen,
    orderNumber: z.string().min(1),
  }),
});

export const hrmsPostingHoldPlaced = defineStContract({
  topic: "hrms.posting.hold_placed",
  kind: "event",
  owner: HRMS,
  version: "1.0",
  // SmartTransfer eligibility consumer is OPEN D-ST-16.
  consumers: ["audit-service"],
  schema: z.object({
    employeeId: zId,
    tenantId: zTenantId,
    holdType: zCode,
    effectiveFrom: zWhen,
    source: zCode,
  }),
});

export const hrmsPostingHoldReleased = defineStContract({
  topic: "hrms.posting.hold_released",
  kind: "event",
  owner: HRMS,
  version: "1.0",
  // SmartTransfer eligibility consumer is OPEN D-ST-16.
  consumers: ["audit-service"],
  schema: z.object({
    employeeId: zId,
    tenantId: zTenantId,
    holdType: zCode,
    releasedOn: zWhen,
    source: zCode,
  }),
});

/** Every `hrms.posting.*` contract in this pack, in event-list order. */
export const hrmsPostingContracts = [
  hrmsPostingApply,
  hrmsPostingApplied,
  hrmsPostingChanged,
  hrmsPostingHoldPlaced,
  hrmsPostingHoldReleased,
] as const;
