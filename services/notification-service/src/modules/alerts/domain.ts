export type AlertRuleView = {
  id: string;
  tenantId: string;
  name: string;
  triggerEvent: string;
  conditions: Record<string, unknown>;
  channel: string;
  recipients: string[];
  enabled: boolean;
  version: number;
};
