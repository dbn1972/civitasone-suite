/**
 * CAP-053 — connector framework tests (no DB; registry not wired → mock fallback).
 */
import { describe, it, expect } from "vitest";
import {
  createConnector,
  createConfiguredConnector,
  listConnectorProviders,
  ConnectorError,
  GstnConnector,
  PfmsConnector,
  type ConnectorConfig,
} from "../src/index.js";

const mockCfg: ConnectorConfig = { mode: "mock", config: {}, secrets: {} };

describe("connector registry", () => {
  it("registers the built-in gstn + pfms connectors", () => {
    const providers = listConnectorProviders();
    expect(providers).toContain("gstn");
    expect(providers).toContain("pfms");
  });

  it("creates a fresh connector instance by provider", () => {
    expect(createConnector("gstn")).toBeInstanceOf(GstnConnector);
    expect(createConnector("pfms")).toBeInstanceOf(PfmsConnector);
    expect(createConnector("nope")).toBeUndefined();
  });
});

describe("BaseConnector config + health", () => {
  it("mock mode is always configured + healthy", async () => {
    const c = new GstnConnector();
    c.configure(mockCfg);
    expect(c.isConfigured()).toBe(true);
    const h = await c.healthCheck();
    expect(h).toMatchObject({ healthy: true, mode: "mock", configured: true });
  });

  it("production mode fails closed without required secrets", async () => {
    const c = new GstnConnector();
    c.configure({ mode: "production", config: { gstin: "27AAAAA0000A1Z5" }, secrets: {} });
    expect(c.isConfigured()).toBe(false);
    const h = await c.healthCheck();
    expect(h.healthy).toBe(false);
    expect(h.detail).toContain("clientId");
    // invoke refuses when not configured
    await expect(c.invoke("fileGstr1", { financialYear: "2026-27", period: "072026", invoices: [] })).rejects.toBeInstanceOf(
      ConnectorError,
    );
  });

  it("production mode is configured once all required secrets are present", () => {
    const c = new PfmsConnector();
    c.configure({ mode: "production", endpointUrl: "https://pfms.example", config: { schemeCode: "SCH-1" }, secrets: { authToken: "tok" } });
    expect(c.isConfigured()).toBe(true);
  });
});

describe("connector invoke (mock)", () => {
  it("gstn fileGstr1 returns a mock filing and rejects unknown operations", async () => {
    const c = new GstnConnector();
    c.configure({ mode: "mock", config: { gstin: "27AAAAA0000A1Z5" }, secrets: {} });
    const res = await c.invoke<{ status: string; referenceId: string }>("fileGstr1", {
      financialYear: "2026-27",
      period: "072026",
      invoices: [],
    });
    expect(res.status).toBe("accepted");
    expect(res.referenceId).toContain("GSTR1");
    await expect(c.invoke("bogusOp")).rejects.toMatchObject({ code: "UNKNOWN_OPERATION" });
  });

  it("pfms initiateDisbursement uses the tenant scheme code and validates input", async () => {
    const c = new PfmsConnector();
    c.configure({ mode: "mock", config: { schemeCode: "SCH-DEFAULT" }, secrets: {} });
    const res = await c.invoke<{ status: string }>("initiateDisbursement", {
      txnRef: "TX-1",
      schemeCode: "",
      amountMinor: 100000n,
      currency: "INR",
      beneficiary: { name: "A", bankAccount: "123", ifsc: "SBIN0000001" },
      narration: "grant",
    });
    expect(["initiated", "queued"]).toContain(res.status);

    // with no scheme code anywhere → BAD_INPUT
    const c2 = new PfmsConnector();
    c2.configure(mockCfg);
    await expect(
      c2.invoke("initiateDisbursement", { txnRef: "T", schemeCode: "", amountMinor: 1n, currency: "INR", beneficiary: { name: "x", bankAccount: "1", ifsc: "i" }, narration: "n" }),
    ).rejects.toMatchObject({ code: "BAD_INPUT" });
  });
});

describe("createConfiguredConnector (registry not wired → mock fallback)", () => {
  it("falls back to mock when integration_settings is not configured", async () => {
    const c = await createConfiguredConnector("gstn", { tenantId: "11111111-1111-4111-8111-111111111111" });
    const h = await c.healthCheck();
    expect(h.mode).toBe("mock");
    expect(h.healthy).toBe(true);
  });

  it("honours an explicit fallback config", async () => {
    const c = await createConfiguredConnector("pfms", {
      tenantId: "11111111-1111-4111-8111-111111111111",
      fallback: { mode: "production", secrets: { authToken: "t" }, config: { schemeCode: "S" }, endpointUrl: "https://x" },
    });
    expect(c.isConfigured()).toBe(true);
  });

  it("throws UNKNOWN_CONNECTOR for an unregistered provider", async () => {
    await expect(createConfiguredConnector("nope", { tenantId: "11111111-1111-4111-8111-111111111111" })).rejects.toMatchObject({
      code: "UNKNOWN_CONNECTOR",
    });
  });
});
