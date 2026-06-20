export type ChannelView = {
  id: string;
  tenantId: string;
  type: string;
  name: string;
  isDefault: boolean;
  enabled: boolean;
  version: number;
};

export type ChannelType = "email" | "sms" | "push" | "in_app" | "whatsapp";
