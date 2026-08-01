import { describe, it, expect } from "vitest";
import { errorMessageFromResponse } from "./browserClient";

function mockRes(status: number, body?: unknown, throwOnJson = false): Response {
  return {
    status,
    clone() {
      return this;
    },
    async json() {
      if (throwOnJson) throw new Error("no body");
      return body;
    },
  } as unknown as Response;
}

describe("errorMessageFromResponse", () => {
  it("prefers the server code + message", async () => {
    const msg = await errorMessageFromResponse(
      mockRes(409, { code: "ALREADY_CLOSED", message: "period is already hard-closed" }),
    );
    expect(msg).toBe("ALREADY_CLOSED: period is already hard-closed");
  });

  it("uses message alone when there is no code", async () => {
    expect(await errorMessageFromResponse(mockRes(400, { message: "IFSC must be exactly 11 characters." }))).toBe(
      "IFSC must be exactly 11 characters.",
    );
  });

  it("reads a nested error.{code,message} envelope", async () => {
    const msg = await errorMessageFromResponse(
      mockRes(503, { error: { code: "INTEGRATION_DISABLED", message: "PFMS is offline" } }),
    );
    expect(msg).toBe("INTEGRATION_DISABLED: PFMS is offline");
  });

  it("falls back to API_ERROR:<status> when the body is absent/unparseable", async () => {
    expect(await errorMessageFromResponse(mockRes(500, undefined, true))).toBe("API_ERROR: 500");
  });

  it("falls back when the body has neither code nor message", async () => {
    expect(await errorMessageFromResponse(mockRes(404, { foo: "bar" }))).toBe("API_ERROR: 404");
  });
});
