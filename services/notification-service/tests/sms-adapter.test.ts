/**
 * SMS adapter unit tests — covers all driver paths and fail-closed behavior.
 */
import { describe, it, expect } from "vitest";
import { SmsAdapter } from "../src/adapters/sms.js";

describe("SmsAdapter", () => {
  it("type is sms", () => {
    const adapter = new SmsAdapter();
    expect(adapter.type).toBe("sms");
  });

  it("stub driver returns ok:false (fail-closed)", async () => {
    process.env.NOTIFICATION_SMS_DRIVER = "stub";
    const adapter = new SmsAdapter();
    const result = await adapter.send({ recipient: "+919876543210", body: "Hello" });
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("error");
    delete process.env.NOTIFICATION_SMS_DRIVER;
  });

  it("unsupported driver returns ok:false", async () => {
    process.env.NOTIFICATION_SMS_DRIVER = "unknown_provider";
    const adapter = new SmsAdapter();
    const result = await adapter.send({ recipient: "+919876543210", body: "Test" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not supported");
    delete process.env.NOTIFICATION_SMS_DRIVER;
  });

  it("twilio driver without creds returns ok:false (fail-closed)", async () => {
    process.env.NOTIFICATION_SMS_DRIVER = "twilio";
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM;
    const adapter = new SmsAdapter();
    const result = await adapter.send({ recipient: "+919876543210", body: "Test" });
    expect(result.ok).toBe(false);
    delete process.env.NOTIFICATION_SMS_DRIVER;
  });

  it("default (no env) is stub → fail-closed", async () => {
    delete process.env.NOTIFICATION_SMS_DRIVER;
    const adapter = new SmsAdapter();
    const result = await adapter.send({ recipient: "+919876543210", body: "Hi" });
    expect(result.ok).toBe(false);
  });
});
