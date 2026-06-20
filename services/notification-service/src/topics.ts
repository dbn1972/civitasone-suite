export const COMMANDS = {
  createTemplate:   "notification.template.create",
  updateTemplate:   "notification.template.update",
  setPrefs:         "notification.prefs.set",
  sendNotification: "notification.send",
  createChannel:    "notification.channel.create",
  createAlertRule:  "notification.alert_rule.create",
  enableAlertRule:  "notification.alert_rule.enable",
  disableAlertRule: "notification.alert_rule.disable",
  createCampaign:   "notification.campaign.create",
  sendCampaign:     "notification.campaign.send",
  cancelCampaign:   "notification.campaign.cancel",
} as const;

export const EVENTS = {
  templateCreated:       "notification.template.created",
  templateUpdated:       "notification.template.updated",
  delivered:             "notification.delivered",
  failed:                "notification.failed",
  permanentlyFailed:     "notification.delivery.permanently_failed",
  prefSet:               "notification.prefs.set",
  channelCreated:        "notification.channel.created",
  alertRuleCreated:      "notification.alert_rule.created",
  campaignCreated:       "notification.campaign.created",
} as const;

export const SERVICE = "notification";
export const RESOURCE = {
  template:  "template",
  delivery:  "delivery",
  prefs:     "prefs",
  channel:   "channel",
  alertRule: "alert_rule",
  campaign:  "campaign",
};
