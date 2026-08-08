import { describe, it, expect } from "vitest";
import {
  buildNotificationPayload,
  SYSTEM_TEMPLATE_IDS,
} from "../src/notification.js";

describe("buildNotificationPayload", () => {
  it("maps known eventType to system template", () => {
    const p = buildNotificationPayload({
      eventType: "citizen.application.approved",
      recipient: "user-1",
    });
    expect(p.templateId).toBe(SYSTEM_TEMPLATE_IDS.citizenApplicationApproved);
  });

  it("allows pack templateId override (FN-08)", () => {
    const packTemplate = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const p = buildNotificationPayload({
      eventType: "citizen.application.approved",
      recipient: "user-1",
      channel: "whatsapp",
      templateId: packTemplate,
      variables: { amount: "100.00", pay_link: "/pay/1" },
    });
    expect(p.templateId).toBe(packTemplate);
    expect(p.channel).toBe("whatsapp");
    expect(p.variables?.pay_link).toBe("/pay/1");
  });
});
