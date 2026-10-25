/** Q34: credential-shaped query parameters are masked in logged request URLs. */
import { describe, expect, it } from "vitest";
import { redactUrlSecrets, redactedReqSerializer } from "./redaction.js";

const TOKEN = `1790000000.${globalThis.crypto.randomUUID().replace(/-/g, "")}`;

describe("redactUrlSecrets", () => {
  it("masks the audit export download token and keeps the rest of the URL", () => {
    const url = `/v1/audit/exports/7d1c/download?token=${TOKEN}`;
    const out = redactUrlSecrets(url);
    expect(out).toBe("/v1/audit/exports/7d1c/download?token=[REDACTED]");
    expect(out).not.toContain(TOKEN);
  });

  it("masks only secret parameters, in any position and any case", () => {
    const out = redactUrlSecrets(`/x?limit=5&Access_Token=${TOKEN}&sig=abc&q=a%20b&token=${TOKEN}#frag`);
    expect(out).toBe("/x?limit=5&Access_Token=[REDACTED]&sig=[REDACTED]&q=a%20b&token=[REDACTED]#frag");
  });

  it("recognises percent-encoded parameter names", () => {
    expect(redactUrlSecrets("/x?%74oken=abc")).toBe("/x?%74oken=[REDACTED]");
  });

  it("leaves URLs with no query, or no secret parameter, unchanged", () => {
    expect(redactUrlSecrets("/v1/audit/exports")).toBe("/v1/audit/exports");
    expect(redactUrlSecrets("/x?a=1&b=2")).toBe("/x?a=1&b=2");
    expect(redactUrlSecrets("/x?flag&token")).toBe("/x?flag&token");
    expect(redactUrlSecrets("")).toBe("");
  });
});

describe("redactedReqSerializer", () => {
  it("keeps the default Fastify req shape but redacts the url", () => {
    const out = redactedReqSerializer({
      method: "GET",
      url: `/v1/audit/exports/1/download?token=${TOKEN}`,
      hostname: "gw",
      ip: "10.0.0.1",
      socket: { remotePort: 4000 },
    });
    expect(out).toEqual({
      method: "GET",
      url: "/v1/audit/exports/1/download?token=[REDACTED]",
      hostname: "gw",
      remoteAddress: "10.0.0.1",
      remotePort: 4000,
    });
  });
});
