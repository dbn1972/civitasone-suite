export type MfaView = {
  id: string;
  tenantId: string;
  userId: string;
  method: string;
  enabled: boolean;
  version: number;
};
