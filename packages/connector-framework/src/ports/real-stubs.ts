/**
 * REAL adapter stubs (production). Every operation throws NotImplementedError
 * naming the provider. Nothing here knows a provider endpoint or protocol; the
 * actual integrations are built during UAT.
 */
import { NotImplementedError, type AdapterContext, type ConnectionTestResult, type IntegrationAdapter } from "./types.js";
import type { EsignInitiateRequest, EsignInitiateResult, EsignProvider, EsignVerifyRequest, EsignVerifyResult } from "./esign.js";
import type { DscSignRequest, DscSignResult, DscSigner } from "./dsc.js";
import type { BankApi, FetchStatusRequest, FetchStatusResult, SubmitPaymentFileRequest, SubmitPaymentFileResult } from "./bank.js";

abstract class StubBase implements IntegrationAdapter {
  readonly mock = false;
  readonly providerKey: string;
  constructor(protected readonly ctx: AdapterContext) {
    this.providerKey = ctx.providerKey;
  }
  protected nope(operation: string): never {
    throw new NotImplementedError(this.ctx.providerName, operation);
  }
  async testConnection(): Promise<ConnectionTestResult> {
    return this.nope("testConnection");
  }
}

export class RealEsignStub extends StubBase implements EsignProvider {
  async initiate(_req: EsignInitiateRequest): Promise<EsignInitiateResult> { return this.nope("initiate"); }
  async verify(_req: EsignVerifyRequest): Promise<EsignVerifyResult> { return this.nope("verify"); }
}

export class RealDscStub extends StubBase implements DscSigner {
  async sign(_req: DscSignRequest): Promise<DscSignResult> { return this.nope("sign"); }
}

export class RealBankStub extends StubBase implements BankApi {
  async submitPaymentFile(_req: SubmitPaymentFileRequest): Promise<SubmitPaymentFileResult> { return this.nope("submitPaymentFile"); }
  async fetchStatus(_req: FetchStatusRequest): Promise<FetchStatusResult> { return this.nope("fetchStatus"); }
}

export class RealGenericStub extends StubBase {}
