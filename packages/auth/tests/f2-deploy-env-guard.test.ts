/**
 * F2 (UAT bundle 10): NODE_ENV=development/test turns on dev-only auth fallbacks
 * (x-tenant-id header tenant for tokens without `tid`, HS256 tokens, skipped
 * boot assertions). UAT runs that way by owner decision; a deployment marked
 * DEPLOY_ENV=production must refuse to boot in that posture.
 */
import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { randomBytes } from "node:crypto";
import { assertDevPostureNotInProduction, isProductionDeployMarked } from "../src/index.js";
import { authPlugin } from "../src/plugin.js";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

function setEnv(nodeEnv: string | undefined, deployEnv: string | undefined): void {
  process.env = { ...ORIGINAL_ENV };
  if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
  if (deployEnv === undefined) delete process.env.DEPLOY_ENV; else process.env.DEPLOY_ENV = deployEnv;
}

describe("F2 dev-posture-in-production boot guard", () => {
  it.each([
    ["development", "production"],
    ["development", "PRODUCTION"],
    ["test", "prod"],
    ["development", " production "],
  ])("throws for NODE_ENV=%s DEPLOY_ENV=%j", (nodeEnv, deployEnv) => {
    setEnv(nodeEnv, deployEnv);
    expect(isProductionDeployMarked()).toBe(true);
    expect(() => assertDevPostureNotInProduction()).toThrow(/DEPLOY_ENV/);
  });

  it.each([
    ["development", undefined], // UAT today (pm2: NODE_ENV=development, no DEPLOY_ENV)
    ["development", "uat"],
    ["development", "staging"],
    ["test", undefined],
    ["production", "production"], // production posture is fine
    [undefined, "production"], // unset NODE_ENV already fails closed (not dev/test)
  ])("does not throw for NODE_ENV=%j DEPLOY_ENV=%j", (nodeEnv, deployEnv) => {
    setEnv(nodeEnv, deployEnv);
    expect(() => assertDevPostureNotInProduction()).not.toThrow();
  });

  it("authPlugin refuses to register in that posture", async () => {
    setEnv("development", "production");
    const app = Fastify();
    await expect(app.register(authPlugin).ready()).rejects.toThrow(/DEPLOY_ENV/);
    await app.close().catch(() => undefined);
  });

  it("authPlugin still boots for the UAT posture (development, no DEPLOY_ENV)", async () => {
    setEnv("development", undefined);
    process.env.INTERNAL_SERVICE_SECRET = randomBytes(16).toString("hex");
    const app = Fastify();
    await app.register(authPlugin);
    await expect(app.ready()).resolves.toBeDefined();
    await app.close();
  });
});
