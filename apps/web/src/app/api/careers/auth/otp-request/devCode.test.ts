import { describe, it, expect } from "vitest";
import { devOtpEchoAllowed, stripDevCode } from "./devCode";

describe("otp-request proxy devCode gate (GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-03)", () => {
  it("allows the echo only with the explicit flag outside production", () => {
    expect(devOtpEchoAllowed({ NODE_ENV: "development" })).toBe(false);
    expect(devOtpEchoAllowed({ ALLOW_DEV_OTP_ECHO: "true", NODE_ENV: "development" })).toBe(true);
    expect(devOtpEchoAllowed({ ALLOW_DEV_OTP_ECHO: "true", NODE_ENV: "production" })).toBe(false);
  });

  it("strips devCode from the upstream body unless allowed", () => {
    const body = JSON.stringify({ challengeId: "c", expiresIn: 600, devCode: "123456" });
    expect(JSON.parse(stripDevCode(body, false))).toEqual({ challengeId: "c", expiresIn: 600 });
    expect(JSON.parse(stripDevCode(body, true)).devCode).toBe("123456");
  });

  it("passes non-JSON and devCode-free bodies through untouched", () => {
    expect(stripDevCode("not json", false)).toBe("not json");
    const ok = JSON.stringify({ challengeId: "c" });
    expect(stripDevCode(ok, false)).toBe(ok);
  });
});
