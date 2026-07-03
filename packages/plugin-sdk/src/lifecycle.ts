/**
 * Plugin lifecycle state machine.
 *
 * States: uploaded → installed → enabled → active → disabled → uninstalled
 * Not all transitions are linear; some allow shortcuts (e.g. enabled → disabled).
 */

export enum PluginState {
  Uploaded = "uploaded",
  Installed = "installed",
  Enabled = "enabled",
  Active = "active",
  Disabled = "disabled",
  Uninstalled = "uninstalled",
}

export type PluginAction =
  | "install"
  | "enable"
  | "activate"
  | "disable"
  | "uninstall";

export interface PluginTransition {
  from: PluginState;
  action: PluginAction;
  to: PluginState;
}

/**
 * All valid state transitions for a plugin.
 */
export const validTransitions: PluginTransition[] = [
  { from: PluginState.Uploaded, action: "install", to: PluginState.Installed },
  { from: PluginState.Installed, action: "enable", to: PluginState.Enabled },
  { from: PluginState.Enabled, action: "activate", to: PluginState.Active },
  { from: PluginState.Active, action: "disable", to: PluginState.Disabled },
  { from: PluginState.Enabled, action: "disable", to: PluginState.Disabled },
  {
    from: PluginState.Disabled,
    action: "uninstall",
    to: PluginState.Uninstalled,
  },
  {
    from: PluginState.Installed,
    action: "uninstall",
    to: PluginState.Uninstalled,
  },
  { from: PluginState.Disabled, action: "enable", to: PluginState.Enabled },
];

/**
 * Transition a plugin from its current state via the given action.
 * Returns the next state or throws if the transition is invalid.
 */
export function transitionPlugin(
  current: PluginState,
  action: PluginAction,
): PluginState {
  const transition = validTransitions.find(
    (t) => t.from === current && t.action === action,
  );
  if (!transition) {
    throw new Error(
      `Invalid plugin transition: cannot "${action}" from state "${current}".`,
    );
  }
  return transition.to;
}
