export const COMMANDS = {
  createRole:       "policy.role.create",
  updateRole:       "policy.role.update",
  addPermission:    "policy.permission.add",
  createBinding:    "policy.binding.create",
  revokeBinding:    "policy.binding.revoke",
  requestBreakglass:"policy.breakglass.request",
  createAbacRule:   "policy.abac.rule.create",
  updateAbacRule:   "policy.abac.rule.update",
  deleteAbacRule:   "policy.abac.rule.delete",
} as const;

export const EVENTS = {
  roleCreated:        "policy.role.created",
  roleUpdated:        "policy.role.updated",
  permissionAdded:    "policy.permission.added",
  bindingCreated:     "policy.binding.created",
  bindingRevoked:     "policy.binding.revoked",
  breakglassRequested:"policy.breakglass.requested",
  abacRuleCreated:    "policy.abac.rule.created",
  abacRuleUpdated:    "policy.abac.rule.updated",
  abacRuleDeleted:    "policy.abac.rule.deleted",
} as const;

export const SERVICE = "policy";
export const RESOURCE = {
  role:       "role",
  binding:    "binding",
  breakglass: "breakglass",
  abacRule:   "abac_rule",
};
