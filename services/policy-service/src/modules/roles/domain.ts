export type RoleView = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
};

export type PermissionView = {
  id: string;
  tenantId: string;
  roleId: string;
  resource: string;
  action: string;
  effect: "allow" | "deny";
  version: number;
};
