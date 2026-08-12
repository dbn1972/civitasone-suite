import { publishCommand } from "../../shared/publish.js";
import type { RequestContext } from "../../shared/context.js";

export function createTradeLicense(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand("revenue.trade_license.create", ctx, payload);
}

export function renewTradeLicense(ctx: RequestContext, id: string, payload: Record<string, unknown>) {
  return publishCommand("revenue.trade_license.renew", ctx, { ...payload, tradeLicenseId: id });
}

export function cancelTradeLicense(ctx: RequestContext, id: string, payload: Record<string, unknown>) {
  return publishCommand("revenue.trade_license.cancel", ctx, { ...payload, tradeLicenseId: id });
}

export function recordLicensePayment(ctx: RequestContext, id: string, payload: Record<string, unknown>) {
  return publishCommand("revenue.trade_license.payment", ctx, { ...payload, tradeLicenseId: id });
}
