export type CampaignView = {
  id: string;
  tenantId: string;
  templateId: string;
  name: string;
  status: string;
  scheduledAt: string | null;
  version: number;
  recipientCount?: number;
  deliveredCount?: number;
};

export type CampaignRecipientView = {
  id: string;
  campaignId: string;
  recipientId: string;
  status: string;
  deliveryId: string | null;
};
