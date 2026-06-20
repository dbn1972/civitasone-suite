export const COMMANDS = {
  createRole:       "policy.role.create",
  updateRole:       "policy.role.update",
  addPermission:    "policy.permission.add",
  createBinding:    "policy.binding.create",
  revokeBinding:    "policy.binding.revoke",
  requestBreakglass:"policy.breakglass.request",
} as const;

export const EVENTS = {
  roleCreated:        "policy.role.created",
  roleUpdated:        "policy.role.updated",
  permissionAdded:    "policy.permission.added",
  bindingCreated:     "policy.binding.created",
  bindingRevoked:     "policy.binding.revoked",
  breakglassRequested:"policy.breakglass.requested",
} as const;

export const SERVICE = "policy";
export const RESOURCE = {
  role:       "role",
  binding:    "binding",
  breakglass: "breakglass",
};
