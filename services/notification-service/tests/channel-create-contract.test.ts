/**
 * GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-05 / -01: pins the notification-service
 * channel contract that the web channels page depends on. There is NO channel
 * "status" enum — delivery health is the boolean `enabled` — and the create
 * body accepts only { type, name, isDefault, enabled } (no provider/config).
 */
import { describe, it, expect } from "vitest";
import { createChannelBody, channelType } from "../src/modules/channels/validators.js";

describe("channel create contract", () => {
  it("accepts the minimal body and defaults enabled=true, isDefault=false", () => {
    const b = createChannelBody.parse({ type: "email", name: "Office email" });
    expect(b).toEqual({ type: "email", name: "Office email", enabled: true, isDefault: false });
  });

  it("rejects an empty name", () => {
    expect(() => createChannelBody.parse({ type: "email", name: "" })).toThrow();
  });

  it("rejects an unknown delivery type", () => {
    expect(() => createChannelBody.parse({ type: "pigeon", name: "x" })).toThrow();
  });

  it("ignores provider/config — they are not part of the contract", () => {
    const b = createChannelBody.parse({ type: "sms", name: "SMS", provider: "sns", config: { region: "ap-south-1" } } as never);
    expect(b).not.toHaveProperty("provider");
    expect(b).not.toHaveProperty("config");
  });

  it("the delivery-type enum is exactly email|sms|push|in_app|whatsapp (no 'status')", () => {
    expect(channelType.options).toEqual(["email", "sms", "push", "in_app", "whatsapp"]);
  });
});
