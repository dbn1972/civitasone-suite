/**
 * V4-E-06 -- ID-card QR HMAC secret must fail closed by ALLOW-LIST.
 * Previously only NODE_ENV === "production" refused to boot without
 * ID_CARD_QR_SECRET; staging/uat/qa/unset silently signed QR codes with a
 * source-visible literal. Only "development" and "test" may use the fallback.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../shared/infra.js", () => ({
  queue: { publish: async () => undefined },
  cache: { get: async () => undefined, set: async () => undefined },
}));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SECRET = process.env.ID_CARD_QR_SECRET;
const REAL_SECRET = `v4-e-06-${globalThis.crypto.randomUUID()}`;

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_CARD_QR_SECRET; else process.env.ID_CARD_QR_SECRET = ORIGINAL_SECRET;
  vi.resetModules();
});

describe("V4-E-06 -- ID_CARD_QR_SECRET fails closed by allow-list", () => {
  it.each(["production", "staging", "uat", "qa", "preprod", "ci", undefined])(
    "refuses to load with NODE_ENV=%s and no ID_CARD_QR_SECRET",
    async (nodeEnv) => {
      vi.resetModules();
      if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
      delete process.env.ID_CARD_QR_SECRET;
      await expect(import("./routes.js")).rejects.toThrow(/ID_CARD_QR_SECRET is required/);
    },
  );

  it("refuses an empty-string secret outside dev/test", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "staging";
    process.env.ID_CARD_QR_SECRET = "";
    await expect(import("./routes.js")).rejects.toThrow(/ID_CARD_QR_SECRET is required/);
  });

  it.each(["production", "staging", undefined])("loads with NODE_ENV=%s once a real secret is injected", async (nodeEnv) => {
    vi.resetModules();
    if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
    process.env.ID_CARD_QR_SECRET = REAL_SECRET;
    await expect(import("./routes.js")).resolves.toBeDefined();
  });

  it.each(["development", "test"])("keeps the dev/test convenience fallback for NODE_ENV=%s", async (nodeEnv) => {
    vi.resetModules();
    process.env.NODE_ENV = nodeEnv;
    delete process.env.ID_CARD_QR_SECRET;
    await expect(import("./routes.js")).resolves.toBeDefined();
  });
});
