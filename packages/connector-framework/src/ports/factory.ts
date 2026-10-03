import {
  MockBankApi, MockDscSigner, MockEsignProvider, MockGenericAdapter, type MockOptions,
} from "./mock.js";
import { RealBankStub, RealDscStub, RealEsignStub, RealGenericStub } from "./real-stubs.js";
import type { AdapterContext, IntegrationAdapter, PlatformIntegrationCategory } from "./types.js";
import type { EsignProvider } from "./esign.js";
import type { DscSigner } from "./dsc.js";
import type { BankApi } from "./bank.js";

/**
 * Provider keys that have a REAL (non-stub) production adapter. Empty today:
 * production calls are intentionally unavailable until UAT integration work.
 * Adding a key here is the single switch that makes test-connection leave the
 * 501 path for that provider.
 */
const REAL_ADAPTER_PROVIDERS: ReadonlySet<string> = new Set<string>();

export function hasRealAdapter(providerKey: string): boolean {
  return REAL_ADAPTER_PROVIDERS.has(providerKey);
}

/**
 * Resolve the adapter for a category + environment: the mock in sandbox, the
 * NotImplemented stub in production. Callers narrow with the typed helpers below.
 */
export function createAdapter(category: PlatformIntegrationCategory, ctx: AdapterContext, opts?: MockOptions): IntegrationAdapter {
  const sandbox = ctx.environment === "sandbox";
  switch (category) {
    case "esign": return sandbox ? new MockEsignProvider(ctx, opts) : new RealEsignStub(ctx);
    case "dsc": return sandbox ? new MockDscSigner(ctx, opts) : new RealDscStub(ctx);
    case "bank_api": return sandbox ? new MockBankApi(ctx, opts) : new RealBankStub(ctx);
    case "pfms": return sandbox ? new MockGenericAdapter(ctx) : new RealGenericStub(ctx);
  }
}

export const createEsignProvider = (ctx: AdapterContext, opts?: MockOptions): EsignProvider =>
  createAdapter("esign", ctx, opts) as EsignProvider;
export const createDscSigner = (ctx: AdapterContext, opts?: MockOptions): DscSigner =>
  createAdapter("dsc", ctx, opts) as DscSigner;
export const createBankApi = (ctx: AdapterContext, opts?: MockOptions): BankApi =>
  createAdapter("bank_api", ctx, opts) as BankApi;
