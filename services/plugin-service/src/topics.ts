export const COMMANDS = {
  createItem: "plugins.item.create",
  pluginInstall: "plugins.registry.install",
  pluginEnable: "plugins.registry.enable",
  pluginDisable: "plugins.registry.disable",
  pluginUninstall: "plugins.registry.uninstall",
  pluginConfigure: "plugins.registry.configure",
  hookRegister: "plugins.hook.register",
  hookDeregister: "plugins.hook.deregister",
  storePut: "plugins.store.put",
  storeDelete: "plugins.store.delete",
} as const;

export const EVENTS = {
  itemCreated: "plugins.item.created",
  pluginInstalled: "plugins.registry.installed",
  pluginEnabled: "plugins.registry.enabled",
  pluginDisabled: "plugins.registry.disabled",
  pluginUninstalled: "plugins.registry.uninstalled",
  pluginConfigured: "plugins.registry.configured",
  hookRegistered: "plugins.hook.registered",
  hookDeregistered: "plugins.hook.deregistered",
  storeUpdated: "plugins.store.updated",
  storeDeleted: "plugins.store.deleted",
} as const;

export const SERVICE = "plugins";
export const RESOURCE = "item";
