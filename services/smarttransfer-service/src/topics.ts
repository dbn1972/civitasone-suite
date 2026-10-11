/**
 * Topic + event names owned by smarttransfer-service.
 *
 * Convention (docs/ARCHITECTURE.md §4): commands are
 * `{service}.{aggregate}.{action}`, events are `{service}.{aggregate}.{past}`.
 *
 * ST-M01-12 wires exactly ONE example write path end-to-end — cycle create.
 * The emitted event `smarttransfer.cycle.created` is a FROZEN contract from the
 * merged ST-M01-06 pack (packages/events/contracts/smarttransfer, #1976,
 * D-ST-19 enforce). The command topic `smarttransfer.cycle.create` is this
 * service's internal command (one consumer; the caller holds the id) — command
 * topics are not required to ship a defineContract (the C0 pack defines only
 * the cross-service command topics run.requested / solve.requested).
 *
 * The remaining movement entities (request, preference, scenario, run,
 * assignment, order, relieving/joining, appeal, evidence) have their tables and
 * frozen event contracts in place but no write path yet — those land in M02+.
 */
export const COMMANDS = {
  createCycle: "smarttransfer.cycle.create",
} as const;

/**
 * Domain events this service OWNS and EMITS. Empty in M01: the only write path
 * (cycle create) records its fact via `audit.event.record` (a topic owned by
 * audit-service, consumed today), not via a `smarttransfer.*` domain event.
 *
 * The frozen `smarttransfer.*` event contracts (ST-M01-06, #1976) live in
 * `packages/events/contracts/smarttransfer` and stay the source of truth for
 * when these events are wired in a later milestone (their named consumers —
 * audit-service, notification-service — do not subscribe yet, so emitting one
 * now would be an orphan event the cross-service-events contract ratchet
 * blocks, and D-101 forbids baselining it without an owner decision). Declaring
 * a topic here that is never published would equally be flagged as an
 * "unemitted event", so this service advertises none until its consumers land.
 */
export const EVENTS = {} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "smarttransfer";

/** Module key in the composition registry (ST-M01-03). */
export const MODULE_KEY = "smarttransfer";
