export type BindingView = {
  id: string;
  tenantId: string;
  userId: string;
  roleId: string;
  status: string;
  version: number;
};

export type BreakglassView = {
  id: string;
  tenantId: string;
  requesterId: string;
  reason: string;
  scope: string;
  grantedUntil: string;
  status: string;
  version: number;
};
