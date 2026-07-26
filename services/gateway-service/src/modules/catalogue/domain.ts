/**
 * CAP-052 — API lifecycle state machine.
 *
 * An API surface moves through draft → active → deprecated → retired. Retired is
 * terminal; a deprecated API may be reinstated to active. Every transition is
 * recorded in catalogue.api_changelog by the repo.
 */

export type ApiStatus = "draft" | "active" | "deprecated" | "retired";
export type ApiAction = "activate" | "deprecate" | "retire" | "reinstate";
export type ChangeType =
  | "registered"
  | "updated"
  | "activated"
  | "deprecated"
  | "retired"
  | "reinstated";

export class LifecycleError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "LifecycleError";
  }
}

const TRANSITIONS: Record<ApiStatus, Partial<Record<ApiAction, ApiStatus>>> = {
  draft:      { activate: "active", deprecate: "deprecated" },
  active:     { deprecate: "deprecated", retire: "retired" },
  deprecated: { retire: "retired", reinstate: "active" },
  retired:    {},
};

const ACTION_CHANGE_TYPE: Record<ApiAction, ChangeType> = {
  activate: "activated",
  deprecate: "deprecated",
  retire: "retired",
  reinstate: "reinstated",
};

/** True for statuses from which no further transition is possible. */
export function isTerminalStatus(status: ApiStatus): boolean {
  return status === "retired";
}

/** Apply a lifecycle action, returning the next status or throwing. */
export function applyLifecycle(current: ApiStatus, action: ApiAction): ApiStatus {
  const next = TRANSITIONS[current][action];
  if (!next) {
    throw new LifecycleError(
      "INVALID_TRANSITION",
      `cannot ${action} an API in status ${current}`,
    );
  }
  return next;
}

/** Map a lifecycle action to its changelog change_type. */
export function changeTypeForAction(action: ApiAction): ChangeType {
  return ACTION_CHANGE_TYPE[action];
}
