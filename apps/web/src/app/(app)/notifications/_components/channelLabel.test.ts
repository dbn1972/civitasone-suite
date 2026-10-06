import { describe, it, expect } from "vitest";
import { channelLabel } from "./channelLabel";

describe("channelLabel (GAP-NOTIFICATIONS-TEMPLATES-03)", () => {
  it("maps known channel keys to human labels", () => {
    expect(channelLabel("in_app")).toBe("In-app");
    expect(channelLabel("sms")).toBe("SMS");
    expect(channelLabel("email")).toBe("Email");
    expect(channelLabel("push")).toBe("Push");
    expect(channelLabel("whatsapp")).toBe("WhatsApp");
    expect(channelLabel("webhook")).toBe("Webhook");
  });

  it("title-cases an unknown key rather than hiding it", () => {
    expect(channelLabel("voice_call")).toBe("Voice Call");
  });

  it("renders — for an empty/missing channel", () => {
    expect(channelLabel("")).toBe("—");
    expect(channelLabel(null)).toBe("—");
    expect(channelLabel(undefined)).toBe("—");
  });
});
